/** The program a new project starts from. */
export const TEMPLATE = `from microbit import *


while True:
    display.scroll('Hello, World!')
    display.show(Image.HEART)
    sleep(2000)
`;

/** The board runs this file on boot, so a new project is named for it and nothing else. */
export const MAIN = 'main.py';
