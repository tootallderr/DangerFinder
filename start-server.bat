@echo off
cd /d "c:\Users\GEorg\Desktop\DangerFinder\backend"
start "DangerFinder Backend" node server.js
echo Backend server started in new window
timeout /t 3 >nul
echo Testing API endpoints...
powershell -Command "try { $response = Invoke-RestMethod -Uri 'http://localhost:3000/api/stats'; Write-Host 'Stats API working:'; Write-Host $response.profiles_scraped 'profiles scraped' } catch { Write-Host 'Error testing API:' $_.Exception.Message }"
