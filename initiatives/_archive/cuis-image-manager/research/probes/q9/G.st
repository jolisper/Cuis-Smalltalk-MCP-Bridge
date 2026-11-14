Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
[ | count ms1 ms2 |
  count := 0.
  ms1 := Time millisecondsToRun: [ (FeatureRequirement name: 'NoSuchPackage') placesToLookForPackagesDo: [ :d | count := count + 1 ] ].
  ms2 := Time millisecondsToRun: [ [ Feature require: 'NoSuchPackage' ] on: FeatureRequirementUnsatisfied do: [ :ex | ex return: nil ] ].
  Transcript show: 'PROBE places=', count printString, ' walkMs=', ms1 printString, ' failedRequireMs=', ms2 printString; newLine ] value.
Smalltalk quitPrimitive: 0.
