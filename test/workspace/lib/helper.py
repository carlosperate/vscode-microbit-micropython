"""A .py in a subfolder. The device filesystem is flat, so this must warn and
must never be flashed. Deleting it removes the only subfolder check there is."""


def greet():
    return "hello from lib"
