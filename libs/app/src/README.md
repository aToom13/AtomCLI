# Application Source Documentation (`libs/app/src`)

This directory contains the actual source code for the application.

## 🔙 [Back to App Library](../README.md)

---

## 📂 Structure

### `components/`
Contains "smart" components that contain business logic or are specific to the application domain. Unlike `libs/ui`, these components are not generic.

### `pages/`
Defines the routing structure of the application. Each file or directory here usually corresponds to a route in the application.

### `context/`
Contains React Context providers for global state management (e.g., AuthContext, ThemeContext).

### `hooks/`
Custom React hooks that encapsulate complex logic specific to the app.

### `utils/`
Helper functions tailored for this specific application.
