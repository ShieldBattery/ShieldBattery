echo "Registering development Psi service..."

sc query "Psi" | findstr /I "RUNNING"^
  && (echo "Service running, stopping" && sc stop Psi && echo "Service exists, deleting" && sc delete Psi)^
  || (sc query "Psi" | findstr /I "SERVICE_NAME:"^
    && (echo "Service exists, deleting" && sc delete Psi)^
    || (echo "Service doesn't exist, OK" && exit /B 0)^
  )

echo "Waiting for service to be actually deleted..."
PING -n 6 127.0.0.1>nul

sc create Psi binpath= "%SHIELDBATTERY_PATH%psi.exe" type= own start= auto
sc start Psi
