"""Test fixture: one real window the tiler can move, closing itself after two minutes.

Spawned twice by test/tile.test.mjs. tkinter is used instead of a PowerShell WinForms window because
those exit immediately in this environment (measured: two spawned `powershell -File window.ps1`
processes were gone before the window ever appeared).
"""

import sys
import tkinter

title = sys.argv[1] if len(sys.argv) > 1 else "octm tile test"
root = tkinter.Tk()
root.title(title)
root.geometry("420x320+60+60")
label = tkinter.Label(root, text=title, font=("Segoe UI", 11))
label.pack(padx=16, pady=16)
root.after(120_000, root.destroy)
root.mainloop()
