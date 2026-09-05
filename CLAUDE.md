@AGENTS.md

# Git · este repositorio se sube SIEMPRE con la cuenta Promptivegrowth

En esta máquina hay **varias cuentas de GitHub** y cada una trabaja un entorno
distinto. La cuenta activa por defecto **no** es la de este proyecto.

    remoto:  https://github.com/Promptivegrowth/Santa-M-nica.git
    cuenta:  Promptivegrowth        ← esta
    NO:      bravoacamus-droid      ← es la activa por defecto

Empujar con la cuenta equivocada falla con `403 Permission denied`, pero el
riesgo real es el contrario: que en otro repositorio se acabe empujando con la
cuenta de este. **Nunca dar por buena la cuenta activa.**

## Cómo se hace un push aquí

El ayudante de credenciales de `github.com` es la CLI de GitHub, y esa CLI
devuelve el token de la cuenta ACTIVA. Así que hay que cambiarla, empujar y
dejarla como estaba:

```bash
ANTERIOR=$(gh auth status 2>&1 | grep -B1 "Active account: true" \
           | grep "Logged in" | sed 's/.*account \([^ ]*\).*/\1/')
gh auth switch --user Promptivegrowth
git push origin HEAD
gh auth switch --user "$ANTERIOR"     # se restaura siempre
```

Se restaura al terminar porque el resto de los entornos de esta máquina
dependen de la cuenta que quede activa. Cambiarla y no devolverla rompería el
trabajo en otro repositorio sin que nadie se entere.

## El seguro que ya está puesto

La configuración local del repositorio lleva:

```
credential.https://github.com.username = Promptivegrowth
```

No elige la cuenta —eso lo hace `gh auth switch`— pero **hace que el push
falle en vez de subir con la cuenta equivocada** si alguien lo intenta sin
cambiarla. Es un seguro, no un automatismo: si un día falla pidiendo
contraseña, es que la cuenta activa no es la correcta.
