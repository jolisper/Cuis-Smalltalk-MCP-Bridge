Transcript logToStdout: true.
Transcript show: 'BUSY at 50'; newLine.
[ [ true ] whileTrue: [ 3 + 4 ] ] forkAt: 50. 1 to: 60 do: [ :i | (Delay forSeconds: 1) wait ].
