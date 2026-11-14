1 to: 40 do: [ :i | (Delay forSeconds: 1) wait ].
Transcript show: 'IDLE timeout'; newLine.
Smalltalk quitPrimitive: 3.
