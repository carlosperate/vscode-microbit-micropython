"""Bench program. Visible from across the room, so a flash that worked is obvious."""

from microbit import button_a, button_b, pin_logo, display, Image, sleep

while True:
    display.show(Image.HEART)
    sleep(500)
    display.scroll("carlos")
    if button_a.was_pressed():
        display.show(Image.ARROW_W)
    elif button_b.was_pressed():
        display.show(Image.ARROW_E)
    elif pin_logo.is_touched():
        display.show(Image.ARROW_N)
    sleep(1000)

