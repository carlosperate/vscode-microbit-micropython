"""Bench program. Visible from across the room, so a flash that worked is obvious."""

from microbit import display, Image, sleep

while True:
    display.show(Image.HEART)
    sleep(500)
    display.scroll("micro:bit")
