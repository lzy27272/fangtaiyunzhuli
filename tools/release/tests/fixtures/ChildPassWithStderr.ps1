[ordered]@{ status = 'PASS' } | ConvertTo-Json
[Console]::Error.WriteLine('controlled-test-stderr')
exit 0
