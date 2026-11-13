Transcript logToStdout: true.
Transcript show: 'BUSY at 40'; newLine.
[ [ true ] whileTrue: [ 3 + 4 ] ] forkAt: 40. 1 to: 60 do: [ :i | (Delay forSeconds: 1) wait ].
