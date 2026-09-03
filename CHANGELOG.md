# Release Notes

## v0.2.0 - Unreleased

- Added a micro:bit simulator, so code can be run there.
  It appears in the side bar on the micro:bit icon.
- The simulator runs the same files a flash would send, from the **Run in
  Simulator** command or the board's own play button.
- Added **Open Simulator Terminal**, a MicroPython REPL on the simulated board,
  in a VS Code terminal of its own.
- Added a Sensors panel under the simulated board: sliders for the
  accelerometer, compass, temperature, light and sound, a gesture to send, and
  the touch pins. Buttons A and B and the logo stay on the board itself.
- Added a Device section above the simulator, with Flash and Serial Terminal
  buttons and a menu of every command on its header.

## v0.1.0 - 2026/08/31

- Initial release.
- Extension can build a MicroPython hex with the user code, flash it and
  open a serial terminal.
- Known issues: Serial terminal echoes inputted text, MicroPython does as well,
  so we get input text doubled.
