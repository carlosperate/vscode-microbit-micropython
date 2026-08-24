# micro:bit MicroPython

Flash MicroPython programs to a BBC micro:bit over WebUSB, and talk to the board
with a serial REPL 🐍🤖.

Works on both desktop and web versions of VS Code and compatible editors.

🚧 This extension is under construction and does not do anything useful yet.
Watch this space, and the issue tracker:
https://github.com/carlosperate/vscode-microbit-micropython/issues

## What it will do

- **Build a hex from your workspace:** The extension will and build a hex with
  your project and MicroPython, similar to the micro:bit's online Python editor.
- **Flash:** Send the built MicroPython hex to a connected micro:bit over WebUSB.
- **Serial & REPL:** A serial terminal to the board, inside VS Code's own terminal.

Every file at the root of your workspace, except for dot files, goes on the
board, not only `main.py` and not only `.py` files.
The device filesystem is flat, so files in subfolders are left out and the
extension tells you which ones.

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
