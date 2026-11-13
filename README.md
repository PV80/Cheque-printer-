# Cheque Printer

A desktop app that prints cheques from signed requisition PDFs. It runs entirely on one
Windows computer: no website, no internet connection, nothing leaves the PC.

Drop a requisition PDF → the app reads the cheque details → checks the approver's signature
box → signed ones go to the print queue, grouped by company and in cheque-number order →
print one company at a time with a prompt that says exactly which leaves to load.

## Installing

1. Get `Cheque-Printer-Setup-x.y.z.exe` from this repository on GitHub: **Actions → latest
   "Test and build Windows installer" run → Artifacts → Cheque-Printer-Setup** (or from
   **Releases** once a version has been tagged).
2. Run it. Windows will show "Windows protected your PC" because the installer is not
   code-signed — choose **More info → Run anyway**.
3. It installs without further questions and opens **Cheque Printer**. A desktop shortcut is added.

### Updating to a newer version

Run the newer `Cheque-Printer-Setup-x.y.z.exe` on the same computer, signed in to Windows as
the same person. Close Cheque Printer first. The installer replaces the program and opens it
again; there is nothing to uninstall and nothing to set up again. Companies, cheque layouts,
signature boxes, people, the register and the archived requisitions are kept, because they
live in the data folder (see *Data and backups*), which the installer never touches.

The version number is shown on the sign-in screen and under Setup → Data and backup, and it
goes up with every build.

If two Cheque Printer icons ever appear, an older copy was installed "for anyone who uses
this computer": remove the older one in Windows Settings → Apps. Removing the program does
not remove the data either.

## First-time setup (administrator, about 30 minutes)

1. **Create the administrator account** on first launch. There is no password reset by email;
   create a second administrator as a spare (Setup → People).
2. **Add each company** (Setup → Companies) — one per cheque book. A typed *Cheque Requisition
   Voucher* is matched by the name at its top. An accounts-system *Payment Receipt* is matched
   by its "Bank:" line, because that names the account the cheque is drawn on. The first time
   a new name or bank account appears the requisition is held; choose its company once and
   the app remembers.
3. **Set the signature boxes** for each company and each kind of form it uses (the voucher and
   the receipt are signed in different places). Open a sample — every page is shown, scroll to
   the one that is signed — and drag a box around where the approver signs. The typed name and
   the underline may be inside it; they are ignored. Then try an unsigned copy: it must read
   *Not signed*.
   - A box ties itself to the nearest signature label ("APPROVED BY", "Authorized By") and
     follows those words if they move down the page or on to another page.
   - A form can have more than one box (page one, and the note on page two). A signature in
     any of them counts.
   - A box already set for the same form at another company is offered as a starting point.
   - If a signed requisition is ever held as unsigned, an administrator can open **Signature
     box…** on it in Held, see where the app looked, and add or move a box. Override is for
     when it genuinely is not signed.
4. **Check the cheque layout** for each company. Positions start from an estimate, so:
   print a test on plain paper → hold it against a real cheque up to the light → nudge the
   fields → repeat until it lines up → Save. For a second company whose cheque is nearly the
   same, use **Copy layout from…** and adjust only what differs.
   - **If the whole print lands too low by the same amount** (typically 13–15 mm), do not
     shift it up. Most office printers cannot take paper shorter than about 127 mm, and a
     cheque is shorter than that; the printer then uses its own longer sheet and the cheque
     page ends up centred on it. Set **Sheet length given to the printer** to 127 or more and
     leave the shift at 0: the cheque is then printed at the top of that sheet, where the leaf
     really is. If the Windows printer has a custom "cheque" paper size, make it the same
     width and the same length as this sheet.
   - **Print upside down** is the other way round the same problem. The leaf goes into the
     printer bottom edge first and the text is turned to match, so any strip the printer
     cannot reach is at the bottom of the cheque, where nothing is printed, instead of over
     the date. Field positions and shifts are still given as you read the cheque. Ticking it
     reverses the printer shift for you; the loading prompt then tells the operator to load
     the leaves bottom edge first. Use one or the other: a longer sheet, or upside down.
   - The layout screen hatches any strip of the cheque the printer cannot reach with the
     current settings, and warns if a field sits in it.
5. **Choose the printer** for each company, or leave "Ask each time". In the Windows print
   window always keep scaling at 100% / actual size.
6. **Add the people** who will use it (Setup → People) with the right role.

## Roles

| | Operator | Supervisor | Administrator |
|---|:-:|:-:|:-:|
| Load requisitions, print signed cheques, record results | ✓ | ✓ | ✓ |
| Combine / discard requisitions | ✓ | ✓ | ✓ |
| Edit cheque details, choose the company | | ✓ | ✓ |
| Load a payroll (gives each cheque its number and date) | | ✓ | ✓ |
| Override an unsigned requisition or possible double payment (reason logged) | | ✓ | ✓ |
| Mark a printed cheque spoiled later | | ✓ | ✓ |
| Companies, layouts, signature boxes, people, backups, undo "printed" | | | ✓ |

An operator who hits an unsigned requisition can call a supervisor over: the supervisor
types their own username, password and a reason in the override window. Both names are logged.

## Daily use

1. **Load** — drag PDFs anywhere onto the window.
2. **Held** — anything not signed, incomplete, or that looks like a duplicate waits here with
   the reason and the fix. To replace an unsigned requisition, just drop the signed copy.
3. **Print queue** — one section per company, lowest cheque number first. Press **Print**,
   load the leaves in the order shown, tick that the first leaf matches, print.
4. Afterwards say what happened to each leaf: printed correctly, spoiled, or did not print.
5. **Register** — everything loaded and what became of it; export to a spreadsheet (CSV).

### Payroll: one PDF, a cheque for each employee

Drop the payroll PDF from the accounts system (one "Salary Slip" per employee, all in one
file). The app splits it into one cheque per slip: payee = the employee, amount = the net
salary. Salary slips carry no cheque number and no cheque date, so a window asks for:

- the **cheque book** (company) — already chosen if the slips name a company the app knows;
- the **date** to print on the cheques;
- the **first cheque number** — the next one after the last in the register is offered. The
  rest follow in order down the list. Change any number and the ones below follow on from
  it (for a leaf taken out of the stack).

Untick anyone not paid by cheque. A slip with nothing to pay cannot be ticked. A number the
company has already used is refused before anything is loaded.

Each slip is checked for the director's signature in its own right, on its own pages. Set
the signature box once, on any one slip (draw it round the director's signature only, not
the employee's line): it is tied to the words "Director's signature" and found on every
slip, whichever page that line falls on. Unsigned slips are held; the others go to the queue.

Dropping the same payroll again offers only the slips not yet loaded.

The print queue has **Clear** on each company and **Clear whole queue**. Cleared requisitions
are kept in the register as discarded; drop the PDF in again to print one after all.

## More than one computer

Each computer keeps its own register. To stop two computers using the same cheque number:

1. On the computer that has been printing: Register → **Send to another computer**. This saves
   a file listing every cheque printed or spoiled there (no passwords, no PDFs).
2. Move the file across (USB stick, shared folder, email).
3. On the other computer: Register → **Receive from another computer** (supervisor or
   administrator).

Those cheque numbers now count as used there too: a requisition for one is held, the same PDF
is refused as already printed, and the queue shows where each cheque book has got to. A
company the receiving computer does not have comes across with its layout. Receiving the same
file twice does no harm. If both computers have already used one number for different
payments, it says so. Do this at the end of each day, or before the other computer prints.

It is a hand-over, not a live link: between hand-overs the computers do not know about each
other.

## Rules the app enforces

- A requisition reaches the queue only when its signature box contains a signature-sized mark,
  or a supervisor has overridden with a reason.
- The amount in words on the requisition must agree with the figures, or it is held.
- Only the first page is read. Supporting pages (invoices, schedules) never supply a payee,
  amount or date. A PDF holding two requisitions is refused: save each as its own file.
  The one exception is a payroll, where every salary slip becomes its own cheque.
- On a salary slip the amount is the net salary, and it must agree with the "To pay" line
  on the same slip, or the cheque is held for a supervisor to check.
- Dates written with numbers only (10/11/2026) are accepted when they can mean one thing:
  one reading is impossible (10/13/2026), or one reading is within days of when the PDF was
  made and the other is weeks away. Otherwise the requisition is held for someone to enter
  the date. The accounts system has printed both month-first and day-first dates.
- Anything the reader is unsure of — an amount in an unusual format, two different amounts or
  cheque numbers, a payee that may run on to a second line — holds the requisition until a
  supervisor has checked the details.
- A cheque number that has been printed or spoiled is never printed again for that company.
- The same PDF is never loaded twice.
- Two requisitions with the same cheque number are both held until someone either combines
  them into one cheque (same payee, amounts added) or discards one (a corrected requisition).
  An override given for one requisition never covers another combined with it later.
- Restoring a backup never makes a cheque that was printed or spoiled printable again.
- Same payee + amount + date on a new cheque number is held as a possible double payment —
  unless the earlier cheque was marked spoiled, which is the normal re-issue case.
- Text that would not fit is shrunk; if it still cannot fit, the cheque is held rather than
  printed cut off.
- If a company's layout or printer shift would put a field off the edge of the sheet (where
  the printer silently leaves it out), that company's cheques are held, and the reason names
  the field and the edge. They return to the queue as soon as the layout is corrected.
- Cheques are marked "sent to the printer" on disk before the job starts. If the app is closed
  or signs out before the result is recorded, they are held — not offered for printing again —
  until someone records what came out.

## What it does not do

- **It does not recognise whose signature it is.** Any signature-sized mark in the box passes.
  It guards against a forgotten approval, not against forgery.
- **It needs PDFs signed on screen.** A printed, pen-signed and scanned page has no readable
  text and is rejected.
- **It is not networked.** Two computers only learn about each other's printed cheques when
  the register file is passed between them (see above).
- **Sign-in is not a vault.** It records who did what and stops casual misuse. Someone with
  full access to the computer's files could still alter the data file.

## Data and backups

Setup → Data and backup shows the data folder (normally
`C:\Users\<name>\AppData\Roaming\Cheque Printer`). It holds `data.json` (register, companies,
people), a copy of every requisition PDF, and an automatic daily backup for 60 days. Copy the
whole folder to a USB drive or network share regularly.

**Locked out?** If every administrator password is lost, close the app, open `data.json` in
Notepad, change `"users":[ ... ]` to `"users":[]`, save, and reopen the app: it will ask for a
new administrator. The register is untouched.

## For developers

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build && npm run e2e
```

```bash
npm run dist
```

- `src/core/` — all rules, as plain functions with unit tests in `tests/` (amounts, dates,
  parsing, signature analysis, hold rules, queue order, layout, permissions, data changes).
- `src/platform/` — PDF reading (pdf.js) and text measuring.
- `src/state/` — app state and the import pipeline.
- `src/components/` — screens.
- `electron/` — the desktop shell: data file, PDF archive, printing, file dialogs.
- `e2e/` — drives the real app end to end, including measuring where text lands on the
  printed page. Sample requisitions are generated; none are real.

`npm run dist` builds the Windows installer (run it on Windows, or let the GitHub workflow do it).
