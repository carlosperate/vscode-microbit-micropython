# BBC micro:bit MicroPython

Flash MicroPython programs to a BBC micro:bit over WebUSB, and talk to the
board with a serial REPL 🐍🤖.

Works on both desktop and web versions of VS Code and compatible editors.

🚧 This extension is still under construction. Most features are implemented
and should be usable, if you find any issues please raise a bug,
it'll be very appreciated!
https://github.com/carlosperate/vscode-microbit-micropython/issues

## What it does

- **Save Hex:** Builds a hex from your workspace and MicroPython, the same way
  the micro:bit's online Python editor does, and saves it. You can copy this
  file onto the `MICROBIT` drive to run your code.
- **Direct Flash:** Send the built MicroPython hex to a connected micro:bit. In a
  Chromium based browser this goes over WebUSB, in desktop VS Code it uses
  the `MICROBIT` USB drive.
- **Open Serial Terminal:** And access the MicroPython REPL from the board,
  inside a VS Code's terminal.

## Your project folder

Every file in your micro:bit project folder goes on the board, not only
`main.py` and not only `.py` files. The default exceptions are: files inside
folders, dot files, and `.hex` files.
The micro:bit internal filesystem is flat, so it cannot contain folders.

The project folder is the whole workspace by default. If your code lives in a
subfolder, run the **Select Project Folder** command to select it.

## What works where

| | Flash | Serial REPL | Save Hex |
|---|---|---|---|
| Desktop VS Code | ✅ copies to the `MICROBIT` drive | ✅ native serial port | ✅ |
| Chrome, Edge and other Chromium browsers | ✅ WebUSB | ✅ WebUSB | ✅ |
| Firefox 151+ (desktop) | ❌ no WebUSB, use Save Hex | ✅ Web Serial | ✅ |
| Safari | ❌ no WebUSB, use Save Hex | ❌ no WebUSB or Web Serial | ✅ |

## How to use it

1. Write your code in `main.py` (or any file in your project folder).
2. Plug in your micro:bit with a USB cable.
3. Click the micro:bit icon at the bottom of the window, a new menu appears at
  the top, and choose **Flash**.
4. Using non-Chromium browsers? Choose **Save Hex** instead, then drag the saved
  file onto the `MICROBIT` drive that appears when you plug in the board.
5. To talk to the board, choose **Open Serial Terminal** from the same menu.
  Press `Ctrl+C` to interrupt the running program and get a MicroPython prompt.

## Requirements

- VS Code desktop, or if used in the browser, a Chromium-based browser for
  WebUSB flashing and Serial Terminal.
    - Firefox also supports the Serial Terminal, using Web Serial instead.
    - Desktop VS Code needs no WebUSB: it copies to the `MICROBIT` drive.
- The Eclipse Serial Monitor extension is installed automatically with this
  extension, used to open a serial terminal.

## Licence

MIT, see [LICENSE](LICENSE).

The bundled MicroPython firmware images come from
[bbcmicrobit/micropython](https://github.com/bbcmicrobit/micropython) (V1) and
[microbit-foundation/micropython-microbit-v2](https://github.com/microbit-foundation/micropython-microbit-v2)
(V2), both MIT licensed.
