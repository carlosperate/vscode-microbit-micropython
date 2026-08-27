# BBC micro:bit MicroPython

Flash MicroPython programs to a BBC micro:bit over WebUSB, and talk to the board
with a serial REPL 🐍🤖.

Works on both desktop and web versions of VS Code and compatible editors.

🚧 This extension is under construction. The implemented features should be
usable, if you find any issues please raise a bug, it'll be very appreciated!
https://github.com/carlosperate/vscode-microbit-micropython/issues

## What it does

- **Flash:** Send the built MicroPython hex to a connected micro:bit over
  WebUSB, in a Chromium based browser. Desktop VS Code cannot pair a board yet,
  so use **Save Hex** there instead.
- **Save Hex:** Builds a hex from your workspace and MicroPython, the same way
  the micro:bit's online Python editor does, and saves it. Copy that file onto
  the `MICROBIT` drive and the board runs your code. Works everywhere, browser
  and desktop alike.

Every file in your micro:bit project folder goes on the board, not only
`main.py` and not only `.py` files. The default exceptions are: files inside
folders, dot files, and `.hex` files.
The micro:bit internal filesystem is flat, so it cannot contain folders.

The project folder is the whole workspace by default. If your code lives in a
subfolder, run the **Select Project Folder** command.

## What still needs to be implemented

- **Serial & REPL:** A serial terminal to the board, inside VS Code's own terminal.
- **Desktop flashing:** copying a hex straight onto a board's `MICROBIT` drive
  from desktop VS Code, without WebUSB.

## How to use it

1. Write your code in `main.py` (or any file in your project folder).
2. Plug in your micro:bit with a USB cable.
3. Click the micro:bit icon at the bottom of the window, a new menu appears at
  at the top, and choose **Flash**.
4. No **Flash** option? Choose **Save Hex** instead, then drag the saved
  file onto the `MICROBIT` drive that appears when you plug in the board.

## Requirements

**A Chromium based browser for flashing and the REPL**, since Firefox and Safari
have no WebUSB, and desktop VS Code cannot pair a board yet either. Everything
else works everywhere: build the hex, save it, and copy it to the board
yourself.

**Nothing is downloaded when you flash.** The MicroPython firmware for both
micro:bit V1 and V2 ships inside the extension.

## Licence

MIT, see [LICENSE](LICENSE).

The bundled MicroPython firmware images come from
[bbcmicrobit/micropython](https://github.com/bbcmicrobit/micropython) (V1) and
[microbit-foundation/micropython-microbit-v2](https://github.com/microbit-foundation/micropython-microbit-v2)
(V2), both MIT licensed.
