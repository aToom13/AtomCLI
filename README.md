# AtomCLI

**[English](#atomcli-english) | [Türkçe](#atomcli-türkçe)**

---

<a name="atomcli-english"></a>
# AtomCLI (English)

**AtomCLI** is a terminal-based AI coding assistant. It integrates directly into your command line workflow using the **Model Context Protocol (MCP)** and a custom **Skill** system.

## 🚀 Key Features

*   **TUI (Terminal User Interface):** Interactive, mouse-supported CLI.
*   **MCP Support:** Connects with local and remote MCP servers.
*   **Skills:** Extend functionality via `.atomcli/skills/`.
*   **Privacy:** All data and configuration are stored locally in your project.

## 📦 Installation

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/aToom13/AtomCLI.git
    cd AtomCLI
    ```

2.  **Install & Build:**
    ```bash
    bun install
    bun run build
    ```

3.  **Link & Run:**
    ```bash
    cd AtomBase
    bun link
    atomcli
    ```

## 🛠 Usage

Run `atomcli` in your project folder.

### Commands
*   `/skill` - List available skills.
*   `/connect` - Connect to an AI provider.
*   `/status` - Show MCP status.
*   `/quit` - Exit.

---

<a name="atomcli-türkçe"></a>
# AtomCLI (Türkçe)

**AtomCLI**, terminal tabanlı bir yapay zeka kodlama asistanıdır. **Model Context Protocol (MCP)** ve özel **Yetenek (Skill)** sistemi kullanarak komut satırı iş akışınıza doğrudan entegre olur.

## 🚀 Temel Özellikler

*   **TUI (Terminal Kullanıcı Arayüzü):** Fare destekli, etkileşimli terminal arayüzü.
*   **MCP Desteği:** Yerel ve uzak MCP sunucuları ile bağlantı kurar.
*   **Yetenekler (Skills):** `.atomcli/skills/` üzerinden işlevselliği genişletin.
*   **Gizlilik:** Tüm veriler ve yapılandırma proje içinde yerel olarak saklanır.

## 📦 Kurulum

1.  **Depoyu Klonlayın:**
    ```bash
    git clone https://github.com/aToom13/AtomCLI.git
    cd AtomCLI
    ```

2.  **Kur ve Derle:**
    ```bash
    bun install
    bun run build
    ```

3.  **Bağla ve Çalıştır:**
    ```bash
    cd AtomBase
    bun link
    atomcli
    ```

## 🛠 Kullanım

Proje dizininizde `atomcli` komutunu çalıştırın.

### Komutlar
*   `/skill` - Mevcut yetenekleri listele.
*   `/connect` - Bir AI sağlayıcısına bağlan.
*   `/status` - MCP durumunu göster.
*   `/quit` - Çıkış yap.
