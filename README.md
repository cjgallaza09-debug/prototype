# Cash Register X Automatic V9.1 – Consolidated Build

This build combines the requested V9.1 updates:

- Customer Order Number textbox in Complete Sale; cashier types the customer/order number.
- Order number is saved with the sale, shown in Sales History/receipt, Excel export, and thermal receipt.
- Cross-platform thermal printer controls in Settings: Connect, Disconnect, Test Print, printer status, and automatic printing after a successful sale.
- Staff can access Settings for My Account, printer controls, and online status. Admin keeps the full Settings controls.
- Checkout saves the parent sale first and uses the returned Supabase sales.id for sale_items.
- Admin-only refunds with validation and Supabase refresh.
- Existing Admin/Staff permissions, PWD 20% discount, separate inventory, and online-only behavior are preserved.

## Supabase
Run `MASTER_DATABASE_FIX.sql` once in the Supabase SQL Editor. It is idempotent and includes the `sales.order_number` and `sales.pwd_discount` columns plus the V9.1 FK/RLS fixes.

## Thermal printer support
The printer panel now supports three browser connection paths:

- **Bluetooth LE / GATT:** for printers that expose a writable BLE characteristic.
- **USB / OTG:** WebUSB path for supported Chromium browsers and printer USB interfaces. Android can use this with a compatible USB-OTG connection.
- **USB or Bluetooth COM / Serial:** Web Serial path for Windows printers exposed as a COM/serial port, including paired Bluetooth Classic/SPP printers when Windows exposes them as a serial port.

The XP-58H label says USB + BT. Many 58H receipt printers use Bluetooth Classic/SPP rather than BLE/GATT, so the browser cannot assume that its Bluetooth connection is directly accessible through Web Bluetooth. The app therefore keeps USB/OTG and Serial/COM as alternatives instead of falsely treating every Bluetooth printer as BLE.

Use **HTTPS** (such as GitHub Pages) and a Chromium-based browser that exposes the required hardware API. Browser hardware APIs are permission-based and device/driver dependent.

### Recommended connection paths
- **Android:** USB/OTG first for the XP-58H; Bluetooth LE only if the printer actually exposes BLE/GATT.
- **Windows:** USB first; if the printer is paired as a COM port, choose Serial/COM and select the printer's baud rate.

The POS saves the sale before attempting automatic printing. A printer failure therefore does not delete the completed sale.
