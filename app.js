/* Cash Register X Automatic - Supabase POS - v7 instant cart rendering */
const cfg=window.SUPABASE_CONFIG||{};
const sb=window.supabase?.createClient(cfg.url||'',cfg.anonKey||'');
let user=null, role='staff', page='dashboard', username='';
window.pwdDiscount=false;
let products=[],categories=[],sales=[],expenses=[],stocks=[],profiles=[],cart=[],editing=null;
const $=id=>document.getElementById(id);
const esc=v=>{const d=document.createElement('div');d.textContent=String(v??'');return d.innerHTML};
const money=v=>'₱'+Number(v||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const today=()=>new Date().toISOString().slice(0,10);
const uid=()=>crypto.randomUUID?.()||String(Date.now()+Math.random());

// Cross-platform thermal printer support.
// Modes:
// 1) Bluetooth LE/GATT (Android + Windows browsers that expose Web Bluetooth)
// 2) WebUSB (USB/OTG printers on supported Chrome/Chromium browsers)
// 3) Web Serial (Windows USB/COM or paired Bluetooth Classic/SPP printers that expose a COM port)
// The XP-58H family commonly uses Bluetooth Classic/SPP, so Windows may work through Web Serial,
// while Android can use USB/OTG unless the printer exposes BLE/GATT.
let printerMode=localStorage.getItem('crx_printer_mode')||'';
let btPrinter=null, btCharacteristic=null, btPrinterName=localStorage.getItem('crx_bt_printer_name')||'';
let usbPrinter=null, usbEndpoint=null, usbInterfaceNumber=null, usbPrinterName=localStorage.getItem('crx_usb_printer_name')||'';
let serialPort=null, serialWriter=null, serialPrinterName=localStorage.getItem('crx_serial_printer_name')||'';
let serialBaud=Number(localStorage.getItem('crx_serial_baud')||9600);
const BT_SERVICE_UUIDS=['0000ffe0-0000-1000-8000-00805f9b34fb','49535343-fe7d-4ae5-8fa9-9fafd205e455','6e400001-b5a3-f393-e0a9-e50e24dcca9e'];
function bluetoothSupported(){return !!navigator.bluetooth&&window.isSecureContext}
function usbSupported(){return !!navigator.usb&&window.isSecureContext}
function serialSupported(){return !!navigator.serial&&window.isSecureContext}
function printerLabel(){return printerMode==='bluetooth'?btPrinterName:printerMode==='usb'?usbPrinterName:printerMode==='serial'?serialPrinterName:''}
function setPrinterStatus(text,type='offline'){
  document.querySelectorAll('[data-printer-status]').forEach(n=>{n.textContent=text;n.className='sync-status '+type});
  localStorage.setItem('crx_printer_status',text);
}
function setPrinterMode(mode,name){printerMode=mode;localStorage.setItem('crx_printer_mode',mode);if(name)localStorage.setItem('crx_printer_name',name);renderPrinterSettingsIfOpen()}
function renderPrinterSettingsIfOpen(){if(page==='settings')render()}
function receiptLine(left,right,width=32){left=String(left);right=String(right);return left+' '.repeat(Math.max(1,width-left.length-right.length))+right+'\n'}
function buildThermalReceipt(sale){
  const w=32; let t='\\x1B\\x40\\x1B\\x61\\x01CASH REGISTER X\nRECEIPT\n\\x1B\\x61\\x00--------------------------------\n';
  if(sale.order_number!==undefined&&sale.order_number!==null&&String(sale.order_number)!=='')t+=`ORDER #${sale.order_number}\n`;
  t+=`Receipt #: ${String(sale.id||'').slice(0,8)}\nDate: ${sale.sale_date||''}\nPayment: ${sale.payment_method||''}\n--------------------------------\n`;
  for(const i of (sale.sale_items||[])){let n=String(i.product_name||'Item');if(n.length>20)n=n.slice(0,20);t+=receiptLine(n,'x'+formatQty(i.quantity),w);t+=receiptLine('',money(i.line_total).replace('₱','P'),w)}
  t+='--------------------------------\n'+receiptLine('Subtotal',money(sale.subtotal).replace('₱','P'),w);
  if(sale.pwd_discount||Number(sale.discount||0)>0)t+=receiptLine('PWD Discount 20%','-'+money(sale.discount).replace('₱','P'),w);
  t+=receiptLine('TOTAL',money(sale.total).replace('₱','P'),w)+receiptLine('Received',money(sale.amount_received).replace('₱','P'),w)+receiptLine('Change',money(sale.change_amount).replace('₱','P'),w);
  t+='--------------------------------\n\\x1B\\x61\\x01THANK YOU!\nPLEASE COME AGAIN\n\n\n\\x1D\\x56\\x00';
  const out=[]; const enc=new TextEncoder();
  for(let i=0;i<t.length;i++){if(t[i]==='\\'&&t[i+1]==='x'){out.push(parseInt(t.slice(i+2,i+4),16));i+=3}else out.push(...enc.encode(t[i]))}
  return new Uint8Array(out);
}
function testSale(){return {id:'TEST1234',order_number:'TEST',sale_date:today(),payment_method:'Cash',subtotal:100,discount:0,total:100,amount_received:100,change_amount:0,sale_items:[{product_name:'Test Receipt',quantity:1,line_total:100}]}}
async function findWritableCharacteristic(server){
  const services=[];
  for(const uuid of BT_SERVICE_UUIDS){try{services.push(await server.getPrimaryService(uuid))}catch(e){}}
  try{for(const svc of await server.getPrimaryServices())if(!services.some(x=>x.uuid===svc.uuid))services.push(svc)}catch(e){}
  for(const svc of services){let chars=[];try{chars=await svc.getCharacteristics()}catch(e){continue}for(const c of chars)if(c.properties.writeWithoutResponse||c.properties.write)return c}
  return null;
}
async function connectBluetoothPrinter(){
  if(!bluetoothSupported()){toast('Bluetooth LE is not available in this browser. Try USB/OTG on Android or Serial on Windows.','error');return false}
  try{
    setPrinterStatus('Selecting Bluetooth…','offline');
    const device=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:BT_SERVICE_UUIDS});
    if(!device.gatt)throw new Error('This printer does not expose BLE/GATT. If it is Bluetooth Classic, use Serial on Windows or USB/OTG on Android.');
    btPrinter=device;btPrinterName=device.name||'Bluetooth Printer';
    localStorage.setItem('crx_bt_printer_name',btPrinterName);
    device.addEventListener('gattserverdisconnected',()=>{btCharacteristic=null;if(printerMode==='bluetooth')setPrinterStatus('Disconnected','offline')});
    const server=await device.gatt.connect();
    btCharacteristic=await findWritableCharacteristic(server);
    if(!btCharacteristic)throw new Error('No writable BLE characteristic found. This printer may use Bluetooth Classic/SPP.');
    setPrinterMode('bluetooth',btPrinterName);setPrinterStatus('Connected: '+btPrinterName,'online');toast('Bluetooth LE printer connected.','success');return true;
  }catch(e){console.error(e);btPrinter=null;btCharacteristic=null;setPrinterStatus('Disconnected','offline');if(e.name!=='NotFoundError')toast(e.message||'Could not connect to Bluetooth printer.','error');return false}
}
async function disconnectBluetoothPrinter(){try{if(btPrinter?.gatt?.connected)btPrinter.gatt.disconnect()}catch(e){}btPrinter=null;btCharacteristic=null;if(printerMode==='bluetooth'){printerMode='';localStorage.removeItem('crx_printer_mode')}setPrinterStatus('Disconnected','offline');renderPrinterSettingsIfOpen();toast('Bluetooth printer disconnected.','success')}
async function writeBluetoothBytes(bytes){if(!btPrinter?.gatt?.connected||!btCharacteristic)throw new Error('Bluetooth LE printer is not connected.');const max=180;for(let i=0;i<bytes.length;i+=max){const c=bytes.slice(i,i+max);if(btCharacteristic.properties.writeWithoutResponse)await btCharacteristic.writeValueWithoutResponse(c);else await btCharacteristic.writeValue(c)}}
async function restoreBluetoothPrinter(){
  if(!bluetoothSupported()||!navigator.bluetooth.getDevices)return false;
  try{const devices=await navigator.bluetooth.getDevices();const wanted=btPrinterName;const device=devices.find(d=>!wanted||d.name===wanted);if(!device?.gatt)return false;btPrinter=device;device.addEventListener('gattserverdisconnected',()=>{btCharacteristic=null;if(printerMode==='bluetooth')setPrinterStatus('Disconnected','offline')});const server=await device.gatt.connect();btCharacteristic=await findWritableCharacteristic(server);if(!btCharacteristic){btPrinter=null;return false}btPrinterName=device.name||btPrinterName||'Bluetooth Printer';setPrinterMode('bluetooth',btPrinterName);setPrinterStatus('Connected: '+btPrinterName,'online');return true}catch(e){console.warn('Bluetooth restore failed:',e);btPrinter=null;btCharacteristic=null;return false}
}

async function connectUsbPrinter(){
  if(!usbSupported()){toast('WebUSB is not available here. Use Bluetooth LE or Serial instead.','error');return false}
  try{
    setPrinterStatus('Selecting USB printer…','offline');
    const device=await navigator.usb.requestDevice({filters:[]});
    await device.open();
    if(device.configuration===null)await device.selectConfiguration(1);
    let chosen=null;
    for(const intf of device.configuration.interfaces){
      for(const alt of intf.alternates){
        const out=alt.endpoints?.find(ep=>ep.direction==='out');
        if(out){chosen={interfaceNumber:intf.interfaceNumber,alternateSetting:alt.alternateSetting,endpointNumber:out.endpointNumber};break}
      }
      if(chosen)break;
    }
    if(!chosen)throw new Error('No writable USB endpoint was found on this printer.');
    await device.claimInterface(chosen.interfaceNumber);
    if(chosen.alternateSetting!==0){try{await device.selectAlternateInterface(chosen.interfaceNumber,chosen.alternateSetting)}catch(e){}}
    usbPrinter=device;usbEndpoint=chosen.endpointNumber;usbInterfaceNumber=chosen.interfaceNumber;usbPrinterName=device.productName||device.manufacturerName||'USB Thermal Printer';
    localStorage.setItem('crx_usb_printer_name',usbPrinterName);setPrinterMode('usb',usbPrinterName);setPrinterStatus('Connected: '+usbPrinterName,'online');toast('USB printer connected.','success');return true;
  }catch(e){console.error(e);try{if(usbPrinter?.opened)await usbPrinter.close()}catch(x){}usbPrinter=null;usbEndpoint=null;usbInterfaceNumber=null;setPrinterStatus('Disconnected','offline');if(e.name!=='NotFoundError')toast(e.message||'Could not connect to USB printer.','error');return false}
}
async function disconnectUsbPrinter(){try{if(usbPrinter?.opened){if(usbInterfaceNumber!==null)try{await usbPrinter.releaseInterface(usbInterfaceNumber)}catch(e){}await usbPrinter.close()}}catch(e){}usbPrinter=null;usbEndpoint=null;usbInterfaceNumber=null;if(printerMode==='usb'){printerMode='';localStorage.removeItem('crx_printer_mode')}setPrinterStatus('Disconnected','offline');renderPrinterSettingsIfOpen();toast('USB printer disconnected.','success')}
async function writeUsbBytes(bytes){if(!usbPrinter?.opened||usbEndpoint===null)throw new Error('USB printer is not connected.');for(let i=0;i<bytes.length;i+=4096){const chunk=bytes.slice(i,i+4096);const r=await usbPrinter.transferOut(usbEndpoint,chunk);if(r.status!=='ok')throw new Error('USB transfer failed: '+r.status)}}

async function connectSerialPrinter(){
  if(!serialSupported()){toast('Web Serial is not available in this browser. Use USB or Bluetooth LE instead.','error');return false}
  try{
    setPrinterStatus('Selecting Serial/COM printer…','offline');
    const port=await navigator.serial.requestPort({filters:[]});
    await port.open({baudRate:serialBaud,dataBits:8,stopBits:1,parity:'none',bufferSize:4096,flowControl:'none'});
    serialPort=port;serialWriter=port.writable?.getWriter();
    if(!serialWriter)throw new Error('Serial port is not writable.');
    serialPrinterName='Serial / COM printer';localStorage.setItem('crx_serial_printer_name',serialPrinterName);setPrinterMode('serial',serialPrinterName);setPrinterStatus('Connected: Serial/COM','online');toast('Serial/COM printer connected.','success');return true;
  }catch(e){console.error(e);try{if(serialWriter)serialWriter.releaseLock();if(serialPort?.readable||serialPort?.writable)await serialPort.close()}catch(x){}serialPort=null;serialWriter=null;setPrinterStatus('Disconnected','offline');if(e.name!=='NotFoundError')toast(e.message||'Could not connect to Serial/COM printer.','error');return false}
}
async function disconnectSerialPrinter(){try{if(serialWriter){serialWriter.releaseLock();serialWriter=null}if(serialPort)await serialPort.close()}catch(e){}serialPort=null;if(printerMode==='serial'){printerMode='';localStorage.removeItem('crx_printer_mode')}setPrinterStatus('Disconnected','offline');renderPrinterSettingsIfOpen();toast('Serial/COM printer disconnected.','success')}
async function writeSerialBytes(bytes){if(!serialPort?.writable||!serialWriter)throw new Error('Serial/COM printer is not connected.');await serialWriter.write(bytes)}

async function restoreUsbPrinter(){
  if(!usbSupported()||!navigator.usb.getDevices)return false;
  try{const devices=await navigator.usb.getDevices();const wanted=usbPrinterName;const device=devices.find(d=>!wanted||d.productName===wanted||d.manufacturerName===wanted);if(!device)return false;await device.open();if(device.configuration===null)await device.selectConfiguration(1);let chosen=null;for(const intf of device.configuration.interfaces){for(const alt of intf.alternates){const out=alt.endpoints?.find(ep=>ep.direction==='out');if(out){chosen={interfaceNumber:intf.interfaceNumber,alternateSetting:alt.alternateSetting,endpointNumber:out.endpointNumber};break}}if(chosen)break}if(!chosen)throw new Error('No writable USB endpoint found.');await device.claimInterface(chosen.interfaceNumber);if(chosen.alternateSetting!==0){try{await device.selectAlternateInterface(chosen.interfaceNumber,chosen.alternateSetting)}catch(e){}}usbPrinter=device;usbEndpoint=chosen.endpointNumber;usbInterfaceNumber=chosen.interfaceNumber;usbPrinterName=device.productName||device.manufacturerName||usbPrinterName||'USB Thermal Printer';setPrinterMode('usb',usbPrinterName);setPrinterStatus('Connected: '+usbPrinterName,'online');return true}catch(e){console.warn('USB restore failed:',e);usbPrinter=null;usbEndpoint=null;usbInterfaceNumber=null;return false}
}
async function restoreSerialPrinter(){
  if(!serialSupported()||!navigator.serial.getPorts)return false;
  try{const ports=await navigator.serial.getPorts();if(!ports.length)return false;const port=ports[0];await port.open({baudRate:serialBaud,dataBits:8,stopBits:1,parity:'none',bufferSize:4096,flowControl:'none'});serialPort=port;serialWriter=port.writable?.getWriter();if(!serialWriter)throw new Error('Serial port is not writable.');serialPrinterName='Serial / COM printer';setPrinterMode('serial',serialPrinterName);setPrinterStatus('Connected: Serial/COM','online');return true}catch(e){console.warn('Serial restore failed:',e);try{if(serialWriter)serialWriter.releaseLock()}catch(x){}serialPort=null;serialWriter=null;return false}
}
async function disconnectPrinter(){
  if(printerMode==='bluetooth')return disconnectBluetoothPrinter();
  if(printerMode==='usb')return disconnectUsbPrinter();
  if(printerMode==='serial')return disconnectSerialPrinter();
  setPrinterStatus('Disconnected','offline');toast('No printer is connected.','error');
}
async function writePrinterBytes(bytes){
  if(printerMode==='bluetooth')return writeBluetoothBytes(bytes);
  if(printerMode==='usb')return writeUsbBytes(bytes);
  if(printerMode==='serial')return writeSerialBytes(bytes);
  throw new Error('No printer is connected.');
}
async function connectPrinter(){
  const mode=$('printerModeSelect')?.value||'bluetooth';
  if(mode==='usb')return connectUsbPrinter();
  if(mode==='serial')return connectSerialPrinter();
  return connectBluetoothPrinter();
}
async function testThermalPrinter(){
  if(!printerMode){if(!(await connectPrinter()))return}
  try{await writePrinterBytes(buildThermalReceipt(testSale()));setPrinterStatus('Connected: '+(printerLabel()||'Printer'),'online');toast('Test receipt sent to printer.','success')}
  catch(e){console.error(e);setPrinterStatus('Disconnected','offline');toast('Test print failed: '+(e.message||'Printer error'),'error')}
}
async function printThermalReceipt(sale){
  if(!printerMode){toast('Sale saved. No thermal printer is connected.','error');return false}
  try{await writePrinterBytes(buildThermalReceipt(sale));setPrinterStatus('Connected: '+(printerLabel()||'Printer'),'online');toast('Receipt printed.','success');return true}
  catch(e){console.error(e);setPrinterStatus('Disconnected','offline');toast('Sale saved, but receipt could not be printed: '+(e.message||'Printer error'),'error');return false}
}
function setSerialBaud(v){serialBaud=Number(v)||9600;localStorage.setItem('crx_serial_baud',String(serialBaud))}
function toast(msg,type=''){const t=$('toast');if(!t)return;t.textContent=msg;t.className='toast '+type;clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.className='',3000)}
function setSyncStatus(text,type=''){const el=$('syncStatus');if(el){el.textContent=text;el.className='sync-status '+type}}
function online(){return navigator.onLine&&!!sb}
function valid(){if((cfg.url&&cfg.anonKey&&sb)||localStorage.getItem(''))return true;toast('Connect to the internet once to sign in and prepare offline mode.','error');return false}
async function q(table,action){try{return await action()}catch(e){return {error:{message:e.message}}}}

const LOCAL_DB='crx-offline-v91';
let dbPromise;let syncing=false;
function openLocalDB(){if(dbPromise)return dbPromise;dbPromise=new Promise(resolve=>{if(!('indexedDB' in window))return resolve(null);const req=indexedDB.open(LOCAL_DB,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('kv'))db.createObjectStore('kv');if(!db.objectStoreNames.contains('queue'))db.createObjectStore('queue',{keyPath:'qid',autoIncrement:true})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>resolve(null)});return dbPromise}
async function idbGet(store,key){const db=await openLocalDB();if(!db)return null;return new Promise(r=>{const tx=db.transaction(store,'readonly');const req=tx.objectStore(store).get(key);req.onsuccess=()=>r(req.result??null);req.onerror=()=>r(null)})}
async function idbSet(store,key,value){const db=await openLocalDB();if(!db)return;return new Promise(r=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=()=>r();tx.onerror=()=>r()})}
async function queueAdd(item){const db=await openLocalDB();if(!db)return;return new Promise(r=>{const tx=db.transaction('queue','readwrite');tx.objectStore('queue').add({...item,queued_at:new Date().toISOString()});tx.oncomplete=()=>r();tx.onerror=()=>r()})}
async function queueAll(){const db=await openLocalDB();if(!db)return[];return new Promise(r=>{const tx=db.transaction('queue','readonly');const req=tx.objectStore('queue').getAll();req.onsuccess=()=>r(req.result||[]);req.onerror=()=>r([])})}
async function queueDelete(qid){const db=await openLocalDB();if(!db)return;return new Promise(r=>{const tx=db.transaction('queue','readwrite');tx.objectStore('queue').delete(qid);tx.oncomplete=()=>r();tx.onerror=()=>r()})}
async function queueRemoveMatching(table,id){const db=await openLocalDB();if(!db)return;return new Promise(r=>{const tx=db.transaction('queue','readwrite'),store=tx.objectStore('queue'),req=store.openCursor();req.onsuccess=()=>{const c=req.result;if(!c)return;if(c.value&&c.value.table===table&&String(c.value.id)===String(id))c.delete();c.continue()};tx.oncomplete=()=>r();tx.onerror=()=>r()})}
async function saveLocalData(){await idbSet('kv','snapshot',{products,categories,sales,expenses,stocks,profiles,saved_at:new Date().toISOString()})}
async function loadLocalData(){const snap=await idbGet('kv','snapshot');if(!snap)return false;products=snap.products||[];categories=snap.categories||[];sales=snap.sales||[];expenses=snap.expenses||[];stocks=snap.stocks||[];profiles=snap.profiles||[];return true}
function localArray(table){return table==='products'?products:table==='categories'?categories:table==='sales'?sales:table==='expenses'?expenses:table==='stocks'?stocks:table==='profiles'?profiles:null}
function applyLocalMutation(table,op,data,id){if(table==='sale_items'){const sale=sales.find(x=>x.id===data.sale_id);if(!sale)return;sale.sale_items=sale.sale_items||[];if(op==='delete')sale.sale_items=sale.sale_items.filter(x=>x.id!==id);else{const idx=sale.sale_items.findIndex(x=>x.id===data.id);if(idx>=0)sale.sale_items[idx]={...sale.sale_items[idx],...data};else sale.sale_items.push(data)}return}const arr=localArray(table);if(!arr)return;if(op==='delete'){const i=arr.findIndex(x=>x.id===id);if(i>=0)arr.splice(i,1);return}const record={...(data||{})};if(!record.id)record.id=id||uid();const i=arr.findIndex(x=>x.id===record.id);if(i>=0)arr[i]={...arr[i],...record};else arr.push(record)}
async function localWrite(table,op,data={},id=null){
  if(!navigator.onLine||!sb){
    setSyncStatus('Offline','offline');
    toast('Internet connection is required to save changes.','error');
    return {data:null,error:{message:'Internet connection is required.'}};
  }
  const record={...data};
  if(op==='insert'&&!record.id)record.id=uid();
  const actualId=id||record.id;
  try{
    let res;
    if(op==='insert')res=await sb.from(table).insert(record).select().single();
    else if(op==='update')res=await sb.from(table).update(record).eq('id',actualId).select().single();
    else if(op==='delete')res=await sb.from(table).delete().eq('id',actualId);
    else throw new Error('Unknown operation');
    if(res.error)throw res.error;
    setSyncStatus('Online','online');
    return {data:res.data||record,error:null};
  }catch(e){
    console.error('Save failed:',e);
    setSyncStatus(navigator.onLine?'Online':'Offline',navigator.onLine?'online':'offline');
    toast(e.message||'Unable to save changes.','error');
    return {data:null,error:e};
  }
}

window.addEventListener('online',()=>{
  setSyncStatus('Online','online');
  if(user)loadAll(true);
});
window.addEventListener('offline',()=>{
  setSyncStatus('Offline','offline');
});

const pageTitles={dashboard:'Dashboard',pos:'Point of Sale',products:'Products',inventory:'Inventory',sales:'Sales History',expenses:'Expenses',reports:'Reports',settings:'Settings',staff:'Staff Accounts'};
// Staff can use Dashboard, POS, Inventory, Sales, and Expenses. Products and management pages remain Admin-only.
const staffPages=new Set(['dashboard','pos','inventory','sales','expenses']);
const canAccessPage=p=>(['products','reports','staff'].includes(p)?role==='admin':p==='settings'?(role==='admin'||role==='staff'):(role==='admin'||role==='staff'||role==='manager')&&staffPages.has(p));
function applyRoleNavigation(){
  document.querySelectorAll('.nav-btn,.mobile-nav-btn').forEach(b=>{
    const allowed=canAccessPage(b.dataset.page);
    b.classList.toggle('hidden',!allowed);
    b.setAttribute('aria-hidden',allowed?'false':'true');
    b.tabIndex=allowed?0:-1;
  });
}
function setPage(p){
  if(!pageTitles[p]||!canAccessPage(p)){
    if(p!==page)toast(['products','reports','staff'].includes(p)?'This page is available to Admin only.':'You do not have access to this page.','error');
    p='dashboard';
  }
  page=p;
  applyRoleNavigation();
  document.querySelectorAll('.nav-btn,.mobile-nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.page===p));
  $('pageTitle').textContent=pageTitles[p];
  render();
  if(innerWidth<=1024)closeSidebar();
}
function modal(title,body){$('modalTitle').textContent=title;$('modalBody').innerHTML='<div class="modal-body">'+body+'</div>';$('modal').classList.remove('hidden')}
function closeModal(){$('modal').classList.add('hidden');editing=null}
$('modalClose').onclick=closeModal;$('modal').onclick=e=>{if(e.target.id==='modal')closeModal()};

let loadingData=false;
async function pendingFor(table){return (await queueAll()).filter(x=>x.table===table)}
function overlayPendingRows(remoteRows, pendingRows){
  const rows=[...(remoteRows||[])];
  for(const item of pendingRows){
    const id=item.id||item.data?.id;
    if(!id)continue;
    if(item.op==='delete'){
      const i=rows.findIndex(x=>String(x.id)===String(id));
      if(i>=0)rows.splice(i,1);
      continue;
    }
    const i=rows.findIndex(x=>String(x.id)===String(id));
    if(i>=0)rows[i]={...rows[i],...(item.data||{})};
    else rows.push({...item.data,id});
  }
  return rows;
}
function overlayPendingSaleItems(remoteSales,pendingItems){
  const rows=(remoteSales||[]).map(s=>({...s,sale_items:[...(s.sale_items||[])]}));
  for(const item of pendingItems){
    const d=item.data||{}, sale=rows.find(s=>String(s.id)===String(d.sale_id));
    if(!sale)continue;
    sale.sale_items=sale.sale_items||[];
    const id=item.id||d.id;
    if(item.op==='delete'){
      sale.sale_items=sale.sale_items.filter(x=>String(x.id)!==String(id));
    }else{
      const i=sale.sale_items.findIndex(x=>String(x.id)===String(id));
      if(i>=0)sale.sale_items[i]={...sale.sale_items[i],...d};
      else sale.sale_items.push({...d,id});
    }
  }
  return rows;
}
async function loadAll(force=false){
  if(loadingData&&!force)return;
  if(!navigator.onLine||!sb){
    setSyncStatus('Offline','offline');
    return;
  }
  loadingData=true;
  setSyncStatus('Online','online');
  try{
    const requests=[
      ['categories',sb.from('categories').select('*').order('name')],
      ['products',sb.from('products').select('*').order('name')],
      ['sales',sb.from('sales').select('*, sale_items(*)').order('created_at',{ascending:false}).limit(500)],
      ['expenses',sb.from('expenses').select('*').order('created_at',{ascending:false}).limit(500)],
      ['stocks',sb.from('stocks').select('*').order('created_at',{ascending:false})]
    ];
    const results=await Promise.all(requests.map(async([table,promise])=>{
      try{
        const {data,error}=await promise;
        return {table,data:data||[],error};
      }catch(e){
        return {table,data:[],error:{message:e.message}};
      }
    }));
    const errors=[];
    for(const r of results){
      if(r.error){
        console.warn(r.table,r.error.message);
        errors.push(r.table);
        continue;
      }
      if(r.table==='categories')categories=r.data;
      else if(r.table==='products')products=r.data;
      else if(r.table==='sales')sales=r.data;
      else if(r.table==='expenses')expenses=r.data;
      else if(r.table==='stocks')stocks=r.data;
    }
    setSyncStatus(errors.length?'Online — partial':'Online','online');
    render();
    if(errors.length)toast('Unable to load: '+errors.join(', '),'error');
  }catch(e){
    console.error('Load failed:',e);
    setSyncStatus('Online — error','online');
    toast(e.message||'Unable to load data.','error');
  }finally{
    loadingData=false;
  }
}

async function loadRole(){
  if(!user||!sb)return;
  const {data,error}=await sb.from('profiles').select('role,username').eq('id',user.id).maybeSingle();
  if(error){
    console.warn('Role load failed',error.message);
    role='staff';
    username='';
    return;
  }
  role=data?.role||'staff';
  username=data?.username||'';
}

async function session(s){
  user=s?.user||null;
  if(!user){
    $('app').classList.add('hidden');
    $('authScreen').classList.remove('hidden');
    return;
  }
  $('authScreen').classList.add('hidden');
  $('app').classList.remove('hidden');
  await loadRole();
  await loadAll();
}

function stat(label,value,sub=''){return `<div class="card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-sub">${sub}</div></div>`}
function recentSales(){return sales.slice(0,8).map(s=>`<tr><td>#${esc(String(s.order_number??'—'))}</td><td>${esc(s.sale_date)}</td><td>${esc(s.payment_method)}</td><td class="num">${money(s.total)}</td><td>${esc(s.status||'completed')}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">No sales yet.</td></tr>'}
function dashboard(){const d=today(),daySales=sales.filter(s=>s.sale_date===d&&!['refunded','void'].includes(s.status));const ds=daySales.reduce((a,s)=>a+Number(s.total||0),0);const de=expenses.filter(e=>e.expense_date===d).reduce((a,e)=>a+Number(e.amount||0),0);const low=stocks.filter(s=>Number(s.quantity)>0&&Number(s.quantity)<=Number(s.low_limit??3)).length,out=stocks.filter(s=>Number(s.quantity)<=0).length;return `<div class="grid stats">${stat("Today's Sales",money(ds),daySales.length+' transaction(s)')}${stat("Today's Expenses",money(de),'Recorded expenses')}${stat('Net Sales',money(ds-de),'Sales minus expenses')}${stat('Inventory Alerts',low+out,low+' low • '+out+' out')}</div><div class="grid two" style="margin-top:16px"><div class="panel"><div class="panel-head"><h3>Recent Sales</h3><button class="btn light" onclick="setPage('sales')">View all</button></div><div class="table-wrap"><table><thead><tr><th>Order #</th><th>Date</th><th>Payment</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>${recentSales()}</tbody></table></div></div><div class="panel"><div class="panel-head"><h3>Inventory Alerts</h3><button class="btn light" onclick="setPage('inventory')">Inventory</button></div>${out?`<div class="alert">${out} item(s) are out of stock.</div>`:''}${low?`<div class="alert">${low} item(s) are low stock.</div>`:''}${!out&&!low?'<div class="empty">Inventory looks good.</div>':stocks.filter(s=>Number(s.quantity)<=Number(s.low_limit??3)).slice(0,7).map(s=>`<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--line)"><span>${esc(s.name)}</span><b class="${Number(s.quantity)===0?'out':'low'}">${s.quantity}</b></div>`).join('')}</div></div>`}

let posSearchTerm='';
function pos(){const cats=categories.length?categories:[{id:'all',name:'All'}];const filtered=pagePosCategory==='all'?products:products.filter(p=>p.category_id===pagePosCategory);return `<div class="pos-layout"><div><div class="mobile-section-title"><b>Products</b><span class="muted">Tap a product to add it</span></div><div class="filters pos-filters" style="margin-bottom:12px"><input id="posSearch" class="search" placeholder="Search product..." value="${esc(posSearchTerm||'')}"><select id="posCat" class="search"><option value="all">All categories</option>${cats.filter(c=>c.id!=='all').map(c=>`<option value="${c.id}" ${pagePosCategory===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div><div class="product-grid">${filtered.filter(p=>!posSearchTerm||p.name.toLowerCase().includes(posSearchTerm.toLowerCase())).map(p=>`<button class="product-btn shape-${esc(p.pos_shape||'box')}" onclick="addCart('${p.id}')"><small>${esc(categories.find(c=>c.id===p.category_id)?.name||'Product')}</small><b>${esc(p.name)}</b><span>${money(p.price)}</span></button>`).join('')||'<div class="empty">No products found.</div>'}</div></div><div id="cartMount">${cartPanel()}</div></div>`}
let pagePosCategory='all';
function stockRecord(pid){return stocks.find(x=>x.product_id===pid)}
function stockFor(pid){const s=stockRecord(pid);return s?Number(s.quantity):'—'}
function stockUnit(pid){return stockRecord(pid)?.unit||'pcs'}
function formatQty(v){const n=Number(v||0);return Number.isInteger(n)?String(n):n.toFixed(3).replace(/0+$/,'').replace(/\.$/,'')}
function unitStep(unit){return unit==='kg'?0.01:1}
function cartSubtotal(){return cart.reduce((a,i)=>a+Number(i.price)*Number(i.qty),0)}
function pwdDiscountAmount(subtotal){return window.pwdDiscount?Number((subtotal*0.20).toFixed(2)):0}
function cartTotal(){const subtotal=cartSubtotal();const discount=pwdDiscountAmount(subtotal);return Math.max(0,subtotal-discount)}
function cartPanel(){
  const subtotal=Number(cart.reduce((sum,i)=>sum+(Number(i.price)||0)*(Number(i.qty)||0),0));
  const discount=pwdDiscountAmount(subtotal);
  const total=Math.max(0,subtotal-discount);
  return `<div class="panel cart" data-cart-total="${total}">
    <div class="panel-head">
      <div><h3>Current Order</h3><small class="muted">${cart.length} item${cart.length===1?'':'s'}</small></div>
      <button class="btn light" onclick="clearCart()">Clear</button>
    </div>
    ${cart.length?cart.map((i,n)=>{
      const qty=Number(i.qty)||0, price=Number(i.price)||0;
      return `<div class="cart-row" data-cart-row="${n}">
        <div><b>${esc(i.name)}</b><small class="muted" style="display:block">${money(price)} / pcs</small></div>
        <input class="qty qty-input" type="number" min="1" step="1" value="${qty}" oninput="changeQtyLive(${n},this.value)" inputmode="numeric">
        <b class="cart-line-total">${money(price*qty)}</b>
        <button class="icon-btn" onclick="removeCart(${n})" aria-label="Remove ${esc(i.name)}">×</button>
      </div>`;
    }).join(''):'<div class="empty">Add products to start an order.</div>'}
    <div class="cart-total">
      <div class="total-line"><span>Subtotal</span><b id="cartSubtotalValue">${money(subtotal)}</b></div>
      <div class="pwd-row"><label class="check-label"><input id="pwdDiscount" type="checkbox" ${window.pwdDiscount?'checked':''}> <span>PWD Discount <b>20%</b></span></label><span id="pwdDiscountValue" class="pwd-value">−${money(discount)}</span></div>
      <div class="total-line big"><span>Total</span><span id="cartTotalValue">${money(total)}</span></div>
      <button class="btn primary wide checkout-btn" onclick="checkout()" ${cart.length?'':'disabled'}>Charge & Complete Sale</button>
    </div>
  </div>`;
}
function updateCartTotalsLive(){
  const subtotal=Number(cart.reduce((sum,i)=>sum+(Number(i.price)||0)*(Number(i.qty)||0),0));
  const discount=pwdDiscountAmount(subtotal);
  const total=Math.max(0,subtotal-discount);
  const subNode=$('cartSubtotalValue'), totalNode=$('cartTotalValue'), cartNode=document.querySelector('.cart');
  if(subNode)subNode.textContent=money(subtotal);
  if(totalNode)totalNode.textContent=money(total);
  if(cartNode)cartNode.dataset.cartTotal=String(total);
  const pwdNode=$('pwdDiscountValue');
  if(pwdNode)pwdNode.textContent='−'+money(discount);
}
function changeQtyLive(i,v){
  if(!cart[i])return;
  let q=Math.max(1,Number(v)||1);
  q=Number(q.toFixed(3));
  cart[i].qty=q;
  const input=document.querySelector(`[data-cart-row="${i}"] .qty-input`);
  if(input && document.activeElement!==input)input.value=q;
  const line=document.querySelector(`[data-cart-row="${i}"] .cart-line-total`);
  if(line)line.textContent=money((Number(cart[i].price)||0)*q);
  updateCartTotalsLive();
}
function togglePwdDiscount(){
  window.pwdDiscount=!!$('pwdDiscount')?.checked;
  updateCartTotalsLive();
}

function updateCartPanelFast(){
  const mount=$('cartMount');
  if(!mount){return render();}

  mount.innerHTML=cartPanel();
  const pwd=$('pwdDiscount');
  if(pwd)pwd.onchange=togglePwdDiscount;
  updateCartTotalsLive();
}
function addCart(id){
  const p=products.find(x=>x.id===id);
  if(!p)return;
  // POS is intentionally independent from Inventory/Stock.
  // Selling a product does not check, read, or change stock.
  const unit='pcs';
  const found=cart.find(x=>x.product_id===id);
  const step=1;
  if(found){
    found.qty=Number((found.qty+step).toFixed(3));
  }else{
    cart.push({product_id:p.id,name:p.name,price:Number(p.price),qty:step,unit});
  }
  // Do NOT rebuild the whole POS page. Only replace the cart panel.
  updateCartPanelFast();
}
function changeQty(i,v){changeQtyLive(i,v)}
function removeCart(i){cart.splice(i,1);updateCartPanelFast()}
function clearCart(){cart=[];window.pwdDiscount=false;updateCartPanelFast()}

function productsPage(){return `<div class="panel"><div class="panel-head"><h3>Product Catalog</h3><div class="actions"><button class="btn primary" onclick="productForm()">+ Add Product</button><button class="btn light" onclick="categoryForm()">Categories</button></div></div><div class="filters"><input id="productSearch" class="search" placeholder="Search products..."></div><div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Product</th><th>Category</th><th>POS Shape</th><th class="num">Price</th><th>Action</th></tr></thead><tbody>${products.map(p=>`<tr><td><b>${esc(p.name)}</b><div class="small">${esc(p.sku||'')}</div></td><td>${esc(categories.find(c=>c.id===p.category_id)?.name||'Uncategorized')}</td><td><span class="shape-badge shape-${esc(p.pos_shape||'box')}">${esc(String(p.pos_shape||'box').replace(/^./,m=>m.toUpperCase()))}</span></td><td class="num">${money(p.price)}</td><td><button class="btn light" onclick="productForm('${p.id}')">Edit</button> <button class="btn danger" onclick="deleteProduct('${p.id}')">Delete</button></td></tr>`).join('')||'<tr><td colspan="5" class="empty">No products yet.</td></tr>'}</tbody></table></div></div>`}
function productForm(id){const p=products.find(x=>x.id===id)||{};const shapes=[['circle','Circle'],['box','Box'],['triangle','Triangle'],['hexagon','Hexagon']];modal(id?'Edit Product':'Add Product',`<form id="productForm"><div class="field-grid"><div class="field"><label>Name<input name="name" required value="${esc(p.name||'')}"></label></div><div class="field"><label>SKU<input name="sku" value="${esc(p.sku||'')}"></label></div><div class="field"><label>Category<select name="category_id"><option value="">Uncategorized</option>${categories.map(c=>`<option value="${c.id}" ${p.category_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label></div><div class="field"><label>Price<input name="price" type="number" min="0" step="0.01" required value="${p.price??''}"></label></div><div class="field"><label>Cost<input name="cost" type="number" min="0" step="0.01" value="${p.cost??0}"></label></div><div class="field"><label>Active<select name="active"><option value="true" ${p.active!==false?'selected':''}>Yes</option><option value="false" ${p.active===false?'selected':''}>No</option></select></label></div><div class="field" style="grid-column:1/-1"><label>POS Button Shape<select name="pos_shape">${shapes.map(([v,l])=>`<option value="${v}" ${(p.pos_shape||'box')===v?'selected':''}>${l}</option>`).join('')}</select></label><div class="form-hint">Choose how this product appears on the POS: Circle, Box, Triangle, or Hexagon.</div></div></div><div class="actions"><button class="btn primary" type="submit">Save Product</button></div></form>`);$('productForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const data={id:p.id||uid(),name:String(f.get('name')||'').trim(),sku:String(f.get('sku')||'').trim()||null,category_id:f.get('category_id')||null,price:Number(f.get('price')),cost:Number(f.get('cost')||0),active:f.get('active')==='true',pos_shape:f.get('pos_shape')||'box'};await localWrite('products',id?'update':'insert',data,data.id);closeModal();render();toast(online()?'Product saved; saving…':'Product saved.','success')}}
async function deleteProduct(id){
  if(!confirm('Delete this product?'))return;
  if(online()&&sb&&user){
    await queueRemoveMatching('products',id);
    const {error}=await sb.from('products').delete().eq('id',id);
    if(error){
      console.error('Product delete failed:',error);
      toast('Product was not deleted: '+(error.message||'Supabase error'),'error');
      return;
    }
    applyLocalMutation('products','delete',{},id);
    await saveLocalData();
    render();
    toast('Product deleted successfully.','success');
    await loadAll(true);
    return;
  }
  await localWrite('products','delete',{},id);
  render();
  toast('Product deleted offline; it will sync when online.','success');
}

function categoryForm(){modal('Categories',`<form id="catForm" class="actions"><input id="catName" class="search" placeholder="Category name" required><button class="btn primary">Add</button></form><div style="margin-top:14px">${categories.map(c=>`<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line)"><span>${esc(c.name)}</span><button class="btn danger" onclick="deleteCategory('${c.id}')">Delete</button></div>`).join('')||'<div class="empty">No categories.</div>'}</div>`);$('catForm').onsubmit=async e=>{e.preventDefault();const name=$('catName').value.trim();if(!name)return;await localWrite('categories','insert',{id:uid(),name});categoryForm();toast(online()?'Category saved; saving…':'Category saved.','success')}}
async function deleteCategory(id){if(!confirm('Delete this category? Products will become uncategorized.'))return;await localWrite('categories','delete',{},id);categoryForm();toast(online()?'Category deleted; saving…':'Category deleted offline.','success')}

function inventory(){return `<div class="panel"><div class="panel-head"><div><h3>Inventory</h3><p class="muted">Track stock using pcs, packs, btls, or kilos.</p></div><div class="actions"><button class="btn primary" onclick="stockForm()">+ Add Stock Item</button><button class="btn success" onclick="exportInventory()">Export Excel</button><label class="btn light">Import Excel<input id="stockImport" type="file" accept=".xlsx,.xls" hidden onchange="importInventory(this)"></label></div></div><div class="table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th class="num">Stock</th><th>Unit</th><th class="num">Low Limit</th><th>Status</th><th>Action</th></tr></thead><tbody>${stocks.map(s=>{const p=products.find(x=>x.id===s.product_id);const q=Number(s.quantity);const unit=s.unit||'pcs';return `<tr><td><b>${esc(p?.name||s.name||'Unknown')}</b></td><td>${esc(p?.sku||'')}</td><td class="num"><input class="qty" value="${q}" type="number" min="0" step="${unitStep(unit)}" onchange="setStock('${s.id}',this.value)"></td><td><span class="unit-badge">${esc(unit)}</span></td><td class="num">${formatQty(s.low_limit??3)}</td><td class="${q===0?'out':q<=Number(s.low_limit??3)?'low':'ok'}">${q===0?'OUT OF STOCK':q<=Number(s.low_limit??3)?'LOW STOCK':'IN STOCK'}</td><td><div class="actions"><button class="btn light" onclick="stockForm('${s.id}')">Edit</button><button class="btn danger" onclick="deleteStock('${s.id}')">Delete</button></div></td></tr>`}).join('')||'<tr><td colspan="7" class="empty">No inventory records. Add a stock item by typing its product name.</td></tr>'}</tbody></table></div></div>`}
async function stockForm(id){
  const s=stocks.find(x=>x.id===id)||{};
  const units=[['pcs','Pieces (pcs)'],['kg','Kilos (kg)'],['packs','Packs'],['btls','Bottles (btls)']];
  const currentProduct=products.find(p=>p.id===s.product_id);
  modal(id?'Edit Stock':'Add Stock',`<form id="stockForm">
    <div class="field-grid">
      <div class="field" style="grid-column:1/-1">
        <label>Product Name
          <input name="product_name" type="text" required autocomplete="off"
            placeholder="Type product name..."
            value="${esc(currentProduct?.name||s.name||'')}">
        </label>
        <div class="form-hint">Type the product name. If it already exists, it will be linked automatically. If it is new, it will be created as a product.</div>
      </div>
      <div class="field">
        <label>Unit
          <select name="unit" required>${units.map(([v,l])=>`<option value="${v}" ${(s.unit||'pcs')===v?'selected':''}>${l}</option>`).join('')}</select>
        </label>
      </div>
      <div class="field">
        <label>Quantity
          <input name="quantity" type="number" min="0" step="0.001" required value="${s.quantity??0}">
        </label>
      </div>
      <div class="field">
        <label>Low Stock Limit
          <input name="low_limit" type="number" min="0" step="0.001" required value="${s.low_limit??3}">
        </label>
      </div>
    </div>
    <div class="form-hint">Use decimals for kilos, for example <b>2.5 kg</b>. Use whole numbers for pcs, packs, and btls.</div>
    <button class="btn primary wide">Save Stock</button>
  </form>`);
  $('stockForm').onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(e.target);
    const productName=String(f.get('product_name')||'').trim();
    const quantity=Math.max(0,Number(f.get('quantity'))||0);
    const unit=String(f.get('unit')||'pcs');
    const low_limit=Math.max(0,Number(f.get('low_limit'))||0);
    if(!productName){toast('Enter a product name.','error');return;}

    let product=products.find(p=>String(p.name||'').trim().toLowerCase()===productName.toLowerCase());

    if(!product){
      const productData={id:uid(),name:productName,price:0,cost:0,active:true,pos_shape:'box'};
      await localWrite('products','insert',productData);
      product=productData;
    }

    const data={
      product_id:product.id,
      name:product.name,
      quantity,
      unit,
      low_limit,
      updated_at:new Date().toISOString()
    };

    if(id){
      await localWrite('stocks','update',data,id);
    }else{
      const existing=stocks.find(x=>x.product_id===product.id);
      if(existing){
        await localWrite('stocks','update',{quantity:Number(existing.quantity||0)+quantity,unit,low_limit,name:product.name,updated_at:new Date().toISOString()},existing.id);
      }else{
        await localWrite('stocks','insert',{id:uid(),...data});
      }
    }

    closeModal();render();toast(online()?'Inventory saved; saving…':'Inventory saved.','success');
  };
}
async function setStock(id,v){const quantity=Math.max(0,Number(v)||0);await localWrite('stocks','update',{quantity},id);render();toast(online()?'Stock updated; saving…':'Stock updated offline.','success')}
async function deleteStock(id){if(!confirm('Delete this inventory record?'))return;await localWrite('stocks','delete',{},id);render();toast(online()?'Stock deleted; saving…':'Stock deleted offline.','success')}

function salesPage(){return `<div class="panel"><div class="panel-head"><h3>Sales History</h3><div class="actions"><button class="btn success" onclick="exportSales()">Export Excel</button><button class="btn light" onclick="printSales()">Print</button></div></div><div class="filters"><input id="salesDate" type="date" value="${window.salesDate||''}" onchange="window.salesDate=this.value;render()" class="search" style="max-width:190px"><select id="salesPayment" class="search" style="max-width:190px"><option value="">All payments</option><option>Cash</option><option>GCash</option><option>Maya</option><option>Card</option><option>Other</option></select><input id="salesSearch" class="search" placeholder="Search order number or receipt..."></div><div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Order #</th><th>Receipt</th><th>Date</th><th>Payment</th><th class="num">Subtotal</th><th class="num">PWD Discount</th><th class="num">Total</th><th>Status</th><th>Action</th></tr></thead><tbody>${sales.filter(s=>!window.salesDate||s.sale_date===window.salesDate).map(s=>`<tr><td><b>#${esc(s.order_number??'—')}</b></td><td>#${esc(String(s.id).slice(0,8))}</td><td>${s.sale_date}</td><td>${esc(s.payment_method)}</td><td class="num">${money(s.subtotal)}</td><td class="num">${(s.pwd_discount || Number(s.discount||0)>0)?money(s.discount):money(0)}</td><td class="num"><b>${money(s.total)}</b></td><td>${esc(s.status||'completed')}</td><td><button class="btn light" onclick="receipt('${s.id}')">Receipt</button>${role==='admin'&&s.status!=='refunded'?` <button class="btn danger" onclick="refundSale('${s.id}')">Refund</button>`:''}</td></tr>`).join('')||'<tr><td colspan="9" class="empty">No sales found.</td></tr>'}</tbody></table></div></div>`}
function receipt(id){const s=sales.find(x=>x.id===id);if(!s)return;modal('Receipt #'+String(id).slice(0,8),`<div style="text-align:center"><h2>Cash Register X</h2>${s.order_number!==undefined&&s.order_number!==null?`<h3>Order #${esc(s.order_number)}</h3>`:''}<p>${s.sale_date} • ${esc(s.payment_method)}</p></div><div class="table-wrap"><table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead><tbody>${(s.sale_items||[]).map(i=>`<tr><td>${esc(i.product_name||'Item')}</td><td class="num">${i.quantity}</td><td class="num">${money(i.line_total)}</td></tr>`).join('')}</tbody></table></div><div class="total-line"><span>Subtotal</span><b>${money(s.subtotal)}</b></div>${(s.pwd_discount || Number(s.discount||0)>0)?`<div class="total-line"><span>PWD Discount (20%)</span><b>−${money(s.discount)}</b></div>`:''}<div class="total-line big"><span>Total</span><b>${money(s.total)}</b></div><button class="btn primary wide" onclick="printThermalReceiptById('${esc(id)}')">Print Receipt</button>`)}
async function printThermalReceiptById(id){const s=sales.find(x=>x.id===id);if(!s)return;await printThermalReceipt(s)}
async function refundSale(id){
  if(role!=='admin'){toast('Admin access required.','error');return;}
  const sale=sales.find(x=>String(x.id)===String(id));
  if(!sale){toast('Sale not found.','error');return;}
  if(['refunded','void'].includes(String(sale.status||'').toLowerCase())){toast('This sale is already closed/refunded.','error');return;}
  if(!confirm(`Refund Order #${sale.order_number??'—'} for ${money(sale.total)}?`))return;
  const result=await localWrite('sales','update',{status:'refunded'},id);
  if(result.error){toast('Refund failed: '+result.error.message,'error');return;}
  await loadAll(true);render();toast('Sale refunded successfully.','success');
}

function expensesPage(){const total=expenses.reduce((a,e)=>a+Number(e.amount||0),0);const cats=['Ingredients','Supplies','Transportation','Utilities','Staff','Equipment','Rent','Maintenance','Other'];return `<div class="grid two expenses-page"><div class="panel"><div class="panel-head"><div><h3>Expenses</h3><p class="muted">Record daily business expenses with useful details.</p></div><button class="btn primary" onclick="expenseForm()">+ Add Expense</button></div><div class="expense-kpi">${stat('Total Recorded',money(total),expenses.length+' entries')}</div><div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Payment</th><th class="num">Amount</th><th>Action</th></tr></thead><tbody>${expenses.map(e=>`<tr><td>${e.expense_date}</td><td>${esc(e.category)}</td><td>${esc(e.description)}</td><td>${esc(e.payment_method||'Cash')}</td><td class="num">${money(e.amount)}</td><td><div class="actions"><button class="btn light" onclick="expenseForm('${e.id}')">Edit</button><button class="btn danger" onclick="deleteExpense('${e.id}')">Delete</button></div></td></tr>`).join('')||'<tr><td colspan="6" class="empty">No expenses recorded yet.</td></tr>'}</tbody></table></div></div><div class="panel"><h3>Expense Summary</h3><p class="muted">Common categories for easier reporting.</p>${cats.map(c=>`<div class="summary-row"><span>${c}</span><b>${money(expenses.filter(e=>e.category===c).reduce((a,e)=>a+Number(e.amount||0),0))}</b></div>`).join('')}</div></div>`}
function expenseForm(id){if(!canAccessPage('expenses')){toast('You do not have access to Expenses.','error');return;}const e=expenses.find(x=>x.id===id)||{};const cats=['Ingredients','Supplies','Transportation','Utilities','Staff','Equipment','Rent','Maintenance','Other'];modal(id?'Edit Expense':'Add Expense',`<form id="expenseForm"><div class="field-grid"><div class="field"><label>Date<input name="expense_date" type="date" required value="${e.expense_date||today()}"></label></div><div class="field"><label>Category<select name="category">${cats.map(c=>`<option ${e.category===c?'selected':''}>${c}</option>`).join('')}</select></label></div><div class="field"><label>Description<input name="description" required value="${esc(e.description||'')}"></label></div><div class="field"><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required value="${e.amount??''}"></label></div><div class="field"><label>Payment Method<select name="payment_method">${['Cash','GCash','Maya','Card','Other'].map(c=>`<option ${e.payment_method===c?'selected':''}>${c}</option>`).join('')}</select></label></div><div class="field"><label>Reference No. <input name="reference_no" value="${esc(e.reference_no||'')}"></label></div></div><button class="btn primary wide">Save Expense</button></form>`);$('expenseForm').onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.target),data={id:e.id||uid(),expense_date:f.get('expense_date'),category:f.get('category'),description:f.get('description').trim(),amount:Number(f.get('amount')),payment_method:f.get('payment_method'),reference_no:f.get('reference_no').trim()||null,added_by:user.id};await localWrite('expenses',id?'update':'insert',data,data.id);closeModal();render();toast(online()?'Expense saved; saving…':'Expense saved.','success')}}
async function deleteExpense(id){if(!canAccessPage('expenses')){toast('You do not have access to Expenses.','error');return;}if(!confirm('Delete this expense?'))return;await localWrite('expenses','delete',{},id);render();toast(online()?'Expense deleted; saving…':'Expense deleted offline.','success')}

function staffPage(){
  if(role!=='admin')return '<div class="panel"><h3>Admin only</h3><p class="muted">Staff account registration is available only to Admin accounts.</p></div>';
  return `<div class="grid two">
    <div class="panel">
      <div class="panel-head"><div><h3>Register Staff Account</h3><p class="muted">Create a Staff login using only a username and password.</p></div></div>
      <form id="staffRegisterForm" class="form-grid">
        <label>Username<input id="staffUsername" type="text" required minlength="3" maxlength="32" autocomplete="off" placeholder="e.g. cashier1"></label>
        <label>Password<input id="staffPassword" type="password" required minlength="6" autocomplete="new-password" placeholder="At least 6 characters"></label>
        <label>Confirm password<input id="staffConfirm" type="password" required minlength="6" autocomplete="new-password" placeholder="Re-enter password"></label>
        <div class="actions"><button class="btn primary" id="staffRegisterBtn" type="submit">Create Staff</button></div>
        <div id="staffRegisterError" class="error"></div><div id="staffRegisterMessage" class="success-text"></div>
      </form>
    </div>
    <div class="panel">
      <div class="panel-head"><div><h3>Staff Accounts</h3><p class="muted">Usernames and assigned roles.</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Username</th><th>Role</th><th>Created</th></tr></thead><tbody id="staffUsersBody"><tr><td colspan="3" class="empty">Loading users...</td></tr></tbody></table></div>
    </div>
  </div>`;
}
async function loadStaffProfiles(){if(role!=='admin'||page!=='staff')return;const body=$('staffUsersBody');if(!body)return;if(!online()){body.innerHTML=(profiles||[]).map(u=>`<tr><td><b>${esc(u.username||'')}</b></td><td><span class="badge">${esc(String(u.role||'staff').toUpperCase())}</span></td><td>${u.created_at?new Date(u.created_at).toLocaleString('en-PH'):''}</td></tr>`).join('')||'<tr><td colspan="3" class="empty">Offline: no cached user list.</td></tr>';return}const {data,error}=await sb.from('profiles').select('username,role,created_at,id').order('created_at',{ascending:false});if(error){body.innerHTML=`<tr><td colspan="3" class="empty">${esc(error.message)}</td></tr>`;return}profiles=data||profiles;await saveLocalData();body.innerHTML=(data||[]).map(u=>`<tr><td><b>${esc(u.username||'')}</b></td><td><span class="badge">${esc(String(u.role||'staff').toUpperCase())}</span></td><td>${u.created_at?new Date(u.created_at).toLocaleString('en-PH'):''}</td></tr>`).join('')||'<tr><td colspan="3" class="empty">No users found.</td></tr>'}

async function registerStaffFromAdmin(e){
  e.preventDefault();
  if(role!=='admin'){toast('Admin access required.','error');return;}
  if(!online()){toast('Staff account creation requires internet. Existing staff can continue offline.','error');return;}
  const uname=$('staffUsername').value.trim().toLowerCase(),password=$('staffPassword').value,confirm=$('staffConfirm').value;
  const err=$('staffRegisterError'),msg=$('staffRegisterMessage'),btn=$('staffRegisterBtn');err.textContent='';msg.textContent='';
  if(!/^[a-z0-9._-]{3,32}$/.test(uname)){err.textContent='Username must be 3-32 characters using letters, numbers, dot, underscore, or hyphen.';return;}
  if(password.length<6){err.textContent='Password must be at least 6 characters.';return;}
  if(password!==confirm){err.textContent='Passwords do not match.';return;}
  btn.disabled=true;btn.textContent='Creating...';
  try{
    const {data:sessionData}=await sb.auth.getSession();
    const token=sessionData?.session?.access_token;
    if(!token)throw new Error('Admin session expired. Please sign in again.');
    const res=await fetch((cfg.url||'').replace(/\/$/,'')+'/functions/v1/create-staff',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'apikey':cfg.anonKey||''},body:JSON.stringify({username:uname,password})});
    const payload=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(payload.error||'Could not create Staff account.');
    $('staffRegisterForm').reset();msg.textContent='Staff account created successfully.';await loadStaffProfiles();
  }catch(ex){err.textContent=ex.message||'Could not create Staff account.';}
  btn.disabled=false;btn.textContent='Create Staff';
}

function reports(){
  if(!canAccessPage('reports'))return '<div class="panel"><h3>Admin only</h3><p class="muted">Reports are available to Admin accounts.</p></div>';
  const completed=sales.filter(s=>!['refunded','void'].includes(s.status));
  const revenue=completed.reduce((a,s)=>a+Number(s.total||0),0);
  const pwdCount=completed.filter(s=>s.pwd_discount || Number(s.discount||0)>0).length;
  const pwdAmount=completed.filter(s=>s.pwd_discount || Number(s.discount||0)>0).reduce((a,s)=>a+Number(s.discount||0),0);
  const expenseTotal=expenses.reduce((a,e)=>a+Number(e.amount||0),0);
  const byPayment={};
  completed.forEach(s=>{const k=s.payment_method||'Other';byPayment[k]=(byPayment[k]||0)+Number(s.total||0);});
  return `<div class="grid stats">${stat('Total Sales',money(revenue),completed.length+' completed transaction(s)')}${stat('PWD Discounts',money(pwdAmount),pwdCount+' transaction(s)')}${stat('Total Expenses',money(expenseTotal),expenses.length+' expense(s)')}${stat('Net Sales',money(revenue-expenseTotal),'Sales minus expenses')}</div><div class="grid two" style="margin-top:16px"><div class="panel"><h3>Payment Summary</h3>${Object.keys(byPayment).length?Object.entries(byPayment).map(([k,v])=>`<div class="summary-row"><span>${esc(k)}</span><b>${money(v)}</b></div>`).join(''):'<div class="empty">No sales yet.</div>'}</div><div class="panel"><h3>PWD Discount Summary</h3><p class="muted">Fixed PWD discount rate: 20%</p><div class="summary-row"><span>PWD transactions</span><b>${pwdCount}</b></div><div class="summary-row"><span>Total discount given</span><b>${money(pwdAmount)}</b></div></div></div>`;
}

function printerSettingsCard(){
  const status=localStorage.getItem('crx_printer_status')||'Disconnected';
  const name=printerLabel()||localStorage.getItem('crx_printer_name')||'Not connected';
  const selected=localStorage.getItem('crx_printer_mode_choice')||printerMode||'bluetooth';
  return `<div class="panel"><h3>Thermal Receipt Printer</h3><p class="muted">Cross-platform controls for Android and Windows. For the XP-58H, use <b>USB / OTG</b> on Android when Bluetooth is Classic/SPP; on Windows you can use <b>USB</b> or a paired Bluetooth printer exposed as a <b>COM/Serial</b> port.</p><p><b>Status:</b> <span data-printer-status class="sync-status ${status.toLowerCase().includes('connected')?'online':'offline'}">${esc(status)}</span></p><p><b>Printer:</b> ${esc(name)}</p><div class="field"><label>Connection method<select id="printerModeSelect" onchange="setPrinterModeChoice(this.value)"><option value="bluetooth" ${selected==='bluetooth'?'selected':''}>Bluetooth LE / GATT</option><option value="usb" ${selected==='usb'?'selected':''}>USB / OTG</option><option value="serial" ${selected==='serial'?'selected':''}>USB or Bluetooth COM / Serial</option></select></label></div><div class="field" style="margin-top:10px"><label>Serial speed<select onchange="setSerialBaud(this.value)">${[9600,19200,38400,57600,115200].map(v=>`<option value="${v}" ${serialBaud===v?'selected':''}>${v} baud</option>`).join('')}</select></label></div><div class="actions" style="margin-top:12px"><button class="btn primary" onclick="connectPrinter()">Connect Printer</button><button class="btn light" onclick="testThermalPrinter()">Test Print</button><button class="btn danger" onclick="disconnectPrinter()">Disconnect</button></div><label class="setting-toggle"><input id="autoPrintToggle" type="checkbox" ${localStorage.getItem('crx_auto_print')!=='false'?'checked':''} onchange="localStorage.setItem('crx_auto_print',this.checked?'true':'false')"> Automatically print receipt after Complete Sale</label><small class="muted">The sale is saved to Supabase before printing. If printing fails, the sale remains saved.</small></div>`
}
function setPrinterModeChoice(mode){localStorage.setItem('crx_printer_mode_choice',mode);if($('printerModeSelect'))$('printerModeSelect').value=mode}
function settings(){
  if(!canAccessPage('settings'))return '<div class="panel"><h3>Access denied</h3><p class="muted">You do not have access to Settings.</p></div>';
  const staff=role==='staff';
  if(staff)return `<div class="grid two"><div class="panel"><h3>My Account</h3><div class="account-row"><span>Username</span><b>${esc(username||'—')}</b></div><div class="account-row"><span>Role</span><b>STAFF</b></div><div class="account-row"><span>Connection</span><span id="staffSettingConnection" class="sync-status ${navigator.onLine?'online':'offline'}">${navigator.onLine?'Online':'Offline'}</span></div></div>${printerSettingsCard()}</div>`;
  return `<div class="grid two"><div class="panel"><h3>Store Settings</h3><div class="field"><label>Store Name<input id="storeName" value="${esc(localStorage.getItem('crx_store')||'Cash Register X')}"></label></div><button class="btn primary" onclick="localStorage.setItem('crx_store',$('storeName').value);toast('Store name saved.')">Save</button></div><div class="panel"><h3>My Account</h3><div class="account-row"><span>Username</span><b>${esc(username||'—')}</b></div><div class="account-row"><span>Role</span><b>ADMIN</b></div></div>${printerSettingsCard()}<div class="panel"><h3>Supabase Connection</h3><p class="muted">Only the publishable/anon key belongs in the browser.</p><p><b>Project:</b> ${esc(cfg.url||'Not configured')}</p><button class="btn light" onclick="loadAll(true)">Test / Refresh Data</button></div><div class="panel"><h3>Data Tools</h3><div class="actions"><button class="btn success" onclick="exportSales()">Export Sales</button><button class="btn success" onclick="exportInventory()">Export Inventory</button><button class="btn success" onclick="exportExpenses()">Export Expenses</button></div></div></div>`;
}

function render(){
  if(!user)return;
  if(!canAccessPage(page))page='dashboard';
  applyRoleNavigation();
  const f={dashboard,pos,products:productsPage,inventory,sales:salesPage,expenses:expensesPage,reports,settings,staff:staffPage};
  try{
    if(typeof f[page]!=='function')throw new Error('Page renderer is unavailable: '+page);
    $('content').innerHTML=f[page]();
  }catch(err){
    console.error('Render error:',err);
    $('content').innerHTML=`<div class="panel"><h3>Unable to load this page</h3><p class="muted">${esc(err?.message||'Unknown error')}</p><button class="btn light" onclick="render()">Try Again</button></div>`;
  }
  if(page==='pos'){
    const s=$('posSearch');
    if(s){
      s.oninput=()=>{
        posSearchTerm=s.value;
        const term=s.value.trim().toLowerCase();
        document.querySelectorAll('.product-btn').forEach(btn=>{
          const name=(btn.querySelector('b')?.textContent||'').toLowerCase();
          btn.style.display=(!term||name.includes(term))?'':'none';
        });
      };
    }
    const c=$('posCat');
    if(c)c.onchange=()=>{pagePosCategory=c.value;render()};
    const pwd=$('pwdDiscount');
    if(pwd)pwd.onchange=togglePwdDiscount;
  }
  if(page==='staff'){
    const form=$('staffRegisterForm');
    if(form)form.onsubmit=registerStaffFromAdmin;
    loadStaffProfiles();
  }
  if(page==='settings'){
    const conn=$('staffSettingConnection');
    if(conn){conn.textContent=navigator.onLine?'Online':'Offline';conn.className='sync-status '+(navigator.onLine?'online':'offline');}
  }
}

async function checkout(){
  if(!cart.length)return;

  // Snapshot the order so later UI changes cannot make checkout use a stale/zero total.
  const order=cart.map(i=>({
    product_id:i.product_id,
    name:i.name,
    price:Number(i.price)||0,
    qty:Number(i.qty)||1,
    unit:i.unit||'pcs'
  }));
  const subtotal=order.reduce((sum,i)=>sum+(i.price*i.qty),0);
  const pwdDiscount=!!window.pwdDiscount;
  const discount=pwdDiscountAmount(subtotal);
  const total=Math.max(0,subtotal-discount);

  modal('Complete Sale',`<form id="checkoutForm">
    <div class="checkout-total">
      <span>Total to pay</span>
      <strong id="checkoutTotal">${money(total)}</strong>
    </div>
    <div class="field order-number-field"><label>Customer Order Number
      <input name="order_number" id="orderNumber" type="text" inputmode="numeric" pattern="[0-9A-Za-z-]+" maxlength="20" required placeholder="Enter customer number" autocomplete="off">
    </label><div class="form-hint">Type the number assigned to this customer. It will appear on the receipt.</div></div>
    <div class="checkout-summary">
      ${order.map(i=>`<div class="summary-row"><span>${esc(i.name)} × ${formatQty(i.qty)}</span><b>${money(i.price*i.qty)}</b></div>`).join('')}
      ${pwdDiscount?`<div class="summary-row"><span>PWD Discount (20%)</span><b>−${money(discount)}</b></div>`:''}
      <div class="summary-row summary-total"><span>Total</span><b>${money(total)}</b></div>
    </div>
    <div class="field-grid">
      <div class="field"><label>Payment Method
        <select name="payment_method" id="paymentMethod">
          <option>Cash</option><option>GCash</option><option>Maya</option><option>Card</option><option>Other</option>
        </select>
      </label></div>
      <div class="field"><label>Amount Received
        <input name="received" id="received" type="number" min="${total}" step="0.01" value="${total}" inputmode="decimal">
      </label></div>
      <div class="field"><label>Change
        <input id="change" class="change-field" readonly value="${money(0)}">
      </label></div>
    </div>
    <div id="cashQuick" class="quick-pay">
      <button type="button" class="btn light" data-pay="${total}">Exact</button>
      <button type="button" class="btn light" data-pay="100">₱100</button>
      <button type="button" class="btn light" data-pay="200">₱200</button>
      <button type="button" class="btn light" data-pay="500">₱500</button>
    </div>
    <p class="checkout-note">Enter the amount received. Change is calculated automatically.</p>
    <button class="btn primary wide checkout-complete" type="submit">Complete Sale</button>
  </form>`);

  const form=$('checkoutForm'), received=$('received'), change=$('change'), orderNumber=$('orderNumber');
  const method=$('paymentMethod'), quick=$('cashQuick'), complete=form?.querySelector('.checkout-complete');
  if(!form||!received||!change||!method||!orderNumber)return;

  const updateChange=()=>{
    const r=Number(received.value)||0;
    change.value=money(Math.max(0,r-total));
  };

  const updatePaymentMode=()=>{
    const cash=method.value==='Cash';
    received.disabled=!cash;
    quick.classList.toggle('hidden',!cash);
    if(!cash){
      received.value=total;
      change.value=money(0);
    }else updateChange();
  };

  received.addEventListener('input',updateChange);
  method.addEventListener('change',updatePaymentMode);
  quick.querySelectorAll('[data-pay]').forEach(b=>{
    b.addEventListener('click',()=>{
      received.value=Math.max(total,Number(b.dataset.pay)||total);
      updateChange();
    });
  });
  updatePaymentMode();

  form.addEventListener('submit',async e=>{
    e.preventDefault();
    if(complete?.disabled)return;

    const fd=new FormData(form);
    const orderNumberValue=String(fd.get('order_number')||'').trim();
    if(!orderNumberValue){orderNumber.focus();toast('Enter the customer order number.','error');return;}
    const receivedValue=method.value==='Cash'?Number(fd.get('received')):total;
    if(method.value==='Cash' && receivedValue<total){
      toast('Amount received is less than total.','error');
      received.focus();
      return;
    }

    if(complete)complete.disabled=true;
    const sale={
      sale_date:today(),
      subtotal,
      discount,
      total,
      payment_method:fd.get('payment_method'),
      pwd_discount:pwdDiscount,
      status:'completed',
      cashier_id:user.id,
      amount_received:receivedValue,
      change_amount:Math.max(0,receivedValue-total),
      order_number:orderNumberValue
    };

    sale.id=uid();

    // Save the parent sale first and use the ID actually returned by Supabase.
    // This prevents sale_items from referencing a sale that was not created.
    let saleResult=await localWrite('sales','insert',sale);

    // If the database has not yet received the V9.1 PWD column migration, retry
    // without that optional tracking column so checkout still works. The normal
    // path stores pwd_discount when the column exists.
    if(saleResult.error && /pwd_discount.*schema cache|could not find the.*pwd_discount/i.test(String(saleResult.error.message||''))){
      const saleWithoutPwd={...sale};
      delete saleWithoutPwd.pwd_discount;
      saleResult=await localWrite('sales','insert',saleWithoutPwd);
    }

    if(saleResult.error || !saleResult.data?.id){
      if(complete)complete.disabled=false;
      toast('Sale was not saved: '+(saleResult.error?.message||'Supabase did not return a sale ID.'),'error');
      return;
    }

    const savedSaleId=saleResult.data.id;
    const savedItems=[];
    for(const item of order){
      const itemResult=await localWrite('sale_items','insert',{
        id:uid(),
        sale_id:savedSaleId,
        product_id:item.product_id,
        product_name:item.name,
        quantity:item.qty,
        unit_price:item.price,
        line_total:item.price*item.qty
      });
      if(itemResult.error){
        // Avoid leaving a parent sale behind when a child item cannot be saved.
        await sb.from('sales').delete().eq('id',savedSaleId);
        if(complete)complete.disabled=false;
        toast('Sale items could not be saved: '+(itemResult.error.message||'Supabase error'),'error');
        return;
      }
      savedItems.push(itemResult.data);
    }

    // Refresh from Supabase so the UI reflects the exact committed records.
    await loadAll(true);
    const committedSale={...sale,id:savedSaleId,sale_items:savedItems};
    if(localStorage.getItem('crx_auto_print')!=='false') await printThermalReceipt(committedSale);
    closeModal();
    cart=[];
    window.pwdDiscount=false;
    render();
    toast(`Sale completed. Change: ${money(Math.max(0,receivedValue-total))}`,'success');
  });
}

function exportXlsx(rows,name,sheet){if(!rows.length){toast('No data to export.','error');return}if(window.XLSX){const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,sheet);XLSX.writeFile(wb,name);return}const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))];const csv=[keys.join(','),...rows.map(r=>keys.map(k=>JSON.stringify(r[k]??'')).join(','))].join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=name.replace(/\.xlsx$/i,'.csv');a.click();URL.revokeObjectURL(a.href);toast('Excel library unavailable offline; CSV exported instead.','success')}
function exportSales(){exportXlsx(sales.map(s=>({Order_Number:s.order_number??'',Receipt:String(s.id),Date:s.sale_date,Payment:s.payment_method,Subtotal:s.subtotal,PWD_Discount:(s.pwd_discount || Number(s.discount||0)>0)?'20%':'',Discount_Amount:s.discount,Total:s.total,Status:s.status})), 'Sales_Report.xlsx','Sales')}
function exportInventory(){exportXlsx(stocks.map(s=>({Product:products.find(p=>p.id===s.product_id)?.name||s.name,SKU:products.find(p=>p.id===s.product_id)?.sku||'',Quantity:s.quantity,Unit:s.unit||'pcs','Low Limit':s.low_limit})), 'Inventory_Report.xlsx','Inventory')}
function exportExpenses(){exportXlsx(expenses.map(e=>({Date:e.expense_date,Category:e.category,Description:e.description,Payment:e.payment_method||'Cash',Reference:e.reference_no||'',Amount:e.amount})), 'Expenses_Report.xlsx','Expenses')}
function printSales(){const rows=sales.filter(s=>!window.salesDate||s.sale_date===window.salesDate);const w=window.open('','_blank');w.document.write('<html><body><h1>Sales Report</h1><table border="1" cellspacing="0" cellpadding="7"><tr><th>Order #</th><th>Date</th><th>Payment</th><th>Total</th></tr>'+rows.map(s=>`<tr><td>#${esc(s.order_number??'—')}</td><td>${s.sale_date}</td><td>${esc(s.payment_method)}</td><td>${money(s.total)}</td></tr>`).join('')+'</table><script>window.print()<\/script></body></html>');w.document.close()}
async function importInventory(input){const file=input.files[0];if(!file)return;if(!window.XLSX){toast('Excel import requires the app to be online at least once so the Excel library can load.','error');input.value='';return}const workbook=XLSX.read(await file.arrayBuffer());const sheet=workbook.Sheets[workbook.SheetNames[0]];const data=XLSX.utils.sheet_to_json(sheet);for(const r of data){const name=String(r.Product||r.Name||'').trim();const q=Number(r.Quantity);const p=products.find(x=>x.name.toLowerCase()===name.toLowerCase());if(!p||!Number.isFinite(q)||q<0)continue;const st=stocks.find(x=>x.product_id===p.id);const unit=String(r.Unit||'pcs').trim()||'pcs';const payload={quantity:q,unit,low_limit:Number(r['Low Limit'])||3,name:p.name,product_id:p.id,updated_at:new Date().toISOString()};await localWrite('stocks',st?'update':'insert',st?payload:{id:uid(),...payload},st?.id)}render();toast(online()?'Inventory import saved; saving…':'Inventory import saved.','success');input.value=''}

$('loginForm').onsubmit=async e=>{
  e.preventDefault();
  if(!navigator.onLine||!sb){
    $('loginError').textContent='Internet connection is required to sign in.';
    setSyncStatus('Offline','offline');
    return;
  }
  const b=$('loginBtn');
  b.disabled=true;
  b.textContent='Signing in…';
  $('loginError').textContent='';
  try{
    const uname=$('username').value.trim().toLowerCase();
    const password=$('password').value;
    if(!uname)throw new Error('Enter your username.');
    if(!password)throw new Error('Enter your password.');
    const {data:email,error:lookupError}=await sb.rpc('get_login_email',{p_username:uname});
    if(lookupError)throw lookupError;
    if(!email)throw new Error('Username not found.');
    const {data,error}=await sb.auth.signInWithPassword({email,password});
    if(error)throw error;
    if(!data?.session||!data?.user)throw new Error('Login succeeded but no session was created.');
    await session(data.session);
  }catch(ex){
    console.error('Login failed:',ex);
    $('loginError').textContent=ex.message||'Sign in failed.';
    $('app').classList.add('hidden');
    $('authScreen').classList.remove('hidden');
  }finally{
    b.disabled=false;
    b.textContent='Sign in';
  }
};
$('logout').onclick=async()=>{if(sb)await sb.auth.signOut();user=null;$('app').classList.add('hidden');$('authScreen').classList.remove('hidden');setSyncStatus(navigator.onLine?'Online':'Offline',navigator.onLine?'online':'offline')};
$('refresh').onclick=()=>loadAll(true);

function openSidebar(){const sidebar=document.querySelector('.sidebar'),overlay=$('sidebarOverlay'),menu=$('menu');sidebar?.classList.add('open');overlay?.classList.add('show');overlay?.setAttribute('aria-hidden','false');if(menu){menu.textContent='×';menu.setAttribute('aria-label','Close navigation');menu.setAttribute('aria-expanded','true')}document.body.classList.add('nav-open')}
function closeSidebar(){const sidebar=document.querySelector('.sidebar'),overlay=$('sidebarOverlay'),menu=$('menu');sidebar?.classList.remove('open');overlay?.classList.remove('show');overlay?.setAttribute('aria-hidden','true');if(menu){menu.textContent='☰';menu.setAttribute('aria-label','Open navigation');menu.setAttribute('aria-expanded','false')}document.body.classList.remove('nav-open')}
function toggleSidebar(){if(window.innerWidth>1024)return;const sidebar=document.querySelector('.sidebar');sidebar?.classList.contains('open')?closeSidebar():openSidebar()}
$('menu').onclick=toggleSidebar;$('sidebarOverlay').onclick=closeSidebar;document.querySelectorAll('.nav-btn,.mobile-nav-btn').forEach(b=>b.onclick=()=>setPage(b.dataset.page));document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSidebar()});window.addEventListener('resize',()=>{if(window.innerWidth>1024)closeSidebar()});
(async()=>{
  const updateStatus=()=>{
    const ok=!!navigator.onLine&&!!sb;
    setSyncStatus(ok?'Online':'Offline',ok?'online':'offline');
  };
  updateStatus();
  if(!sb){
    $('authScreen').classList.remove('hidden');
    $('app').classList.add('hidden');
  }else{
    sb.auth.onAuthStateChange((_e,s)=>{
      if(_e==='SIGNED_OUT'){
        session(null);
      }else if(_e!=='INITIAL_SESSION'&&s?.user){
        setTimeout(()=>session(s),0);
      }
    });
    const {data}=await sb.auth.getSession();
    if(data.session)await session(data.session);
  }
  $('todayLabel').textContent=new Date().toLocaleDateString('en-PH',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  setPrinterStatus(localStorage.getItem('crx_printer_status')||'Disconnected',String(localStorage.getItem('crx_printer_status')||'').startsWith('Connected')?'online':'offline');
  restoreBluetoothPrinter().catch(()=>{});
  restoreUsbPrinter().catch(()=>{});
  restoreSerialPrinter().catch(()=>{});
  window.addEventListener('online',updateStatus);
  window.addEventListener('offline',updateStatus);
  // Do not register a service worker in the online-only build.
  if('serviceWorker' in navigator){
    try{
      const regs=await navigator.serviceWorker.getRegistrations();
      for(const r of regs)await r.unregister();
    }catch(e){console.warn('Service worker cleanup:',e)}
  }
})();
window.setPage=setPage;window.render=render;window.addCart=addCart;window.changeQty=changeQty;window.changeQtyLive=changeQtyLive;window.togglePwdDiscount=togglePwdDiscount;window.removeCart=removeCart;window.clearCart=clearCart;window.checkout=checkout;window.productForm=productForm;window.deleteProduct=deleteProduct;window.categoryForm=categoryForm;window.deleteCategory=deleteCategory;window.stockForm=stockForm;window.setStock=setStock;window.deleteStock=deleteStock;window.expenseForm=expenseForm;window.deleteExpense=deleteExpense;window.receipt=receipt;window.refundSale=refundSale;window.exportSales=exportSales;window.exportInventory=exportInventory;window.exportExpenses=exportExpenses;window.printSales=printSales;window.connectBluetoothPrinter=connectBluetoothPrinter;window.disconnectBluetoothPrinter=disconnectBluetoothPrinter;window.connectUsbPrinter=connectUsbPrinter;window.disconnectUsbPrinter=disconnectUsbPrinter;window.connectSerialPrinter=connectSerialPrinter;window.disconnectSerialPrinter=disconnectSerialPrinter;window.connectPrinter=connectPrinter;window.disconnectPrinter=disconnectPrinter;window.testThermalPrinter=testThermalPrinter;window.restoreBluetoothPrinter=restoreBluetoothPrinter;window.setSerialBaud=setSerialBaud;window.setPrinterModeChoice=setPrinterModeChoice;window.printThermalReceipt=printThermalReceipt;window.printThermalReceiptById=printThermalReceiptById;window.importInventory=importInventory;window.closeModal=closeModal;
