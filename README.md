# BBC micro:bit MicroPython

Flash MicroPython programs to a BBC micro:bit over WebUSB, and talk to the board
with a serial REPL 🐍🤖.

Works on both desktop and web versions of VS Code and compatible editors.

🚧 This extension is under construction. **Save Hex** works today; flashing over
WebUSB and the REPL do not yet. Watch this space, and the issue tracker:
https://github.com/carlosperate/vscode-microbit-micropython/issues

## What it does

- **Save Hex:** Builds a hex from your workspace and MicroPython, the same way
  the micro:bit's online Python editor does, and saves it. Copy that file onto
  the `MICROBIT` drive and the board runs your code. Works in every browser.

## What it will do

- **Flash:** Send the built MicroPython hex to a connected micro:bit over WebUSB.
- **Serial & REPL:** A serial terminal to the board, inside VS Code's own terminal.

Every file in your micro:bit project folder goes on the board, not only
`main.py` and not only `.py` files. Dot files are left out, and so are `.hex`
files, which are what this extension builds rather than something to put on the
board. The device filesystem is flat, so files in subfolders are left out too
and the extension tells you which ones.

The project folder is the whole workspace by default. If your code lives in a
subfolder, right-click it and choose **Select Project Folder**, or set
`microbit-micropython.projectFolder`.

## Requirements

**A Chromium based browser for flashing and the REPL**, since Firefox and Safari
have no WebUSB. Everything else works everywhere: build the hex, save it, and
copy it to the board yourself.

**Nothing is downloaded when you flash.** The MicroPython firmware for both
micro:bit V1 and V2 ships inside the extension.

## Licence

MIT, see [LICENSE](LICENSE).

The bundled MicroPython firmware images come from
[bbcmicrobit/micropython](https://github.com/bbcmicrobit/micropython) (V1) and
[microbit-foundation/micropython-microbit-v2](https://github.com/microbit-foundation/micropython-microbit-v2)
(V2), both MIT licensed.
