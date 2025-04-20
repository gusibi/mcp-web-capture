# Privacy Policy for MCP Web Content Collector

*Last updated: 2025-04-20*

## Introduction

This Privacy Policy explains how the MCP Web Content Collector Chrome Extension ("we", "our", or "the extension") handles information when you use our tool. We are committed to protecting your privacy and ensuring transparency about our data practices.

## Information Collection

To provide its functionality, the extension needs to access or collect certain types of information:

### Information We Access/Collect:

1.  **User-Initiated Web Content:**
    *   **URLs:** The specific web page URLs you instruct the extension to process.
    *   **DOM Structure:** Data about the structure (HTML elements and their hierarchy) of the web pages you target, obtained via content scripts.
    *   **Screenshots:** Temporary image data (as Base64 strings) generated when you use the screenshot feature.
2.  **Data Transmitted via WebSocket:**
    *   Web page URLs being processed.
    *   CSS selector paths for targeted elements.
    *   Anonymized data representing the page structure relevant to the collection task.
3.  **Locally Stored Data (using `chrome.storage.local`):**
    *   **User Configuration:** Settings you configure in the extension's options.
    *   **Connection Credentials:** Credentials required to connect to your designated MCP server, stored encrypted (AES-256).
4.  **Server-Side Data (Your Designated MCP Server):**
    *   **Task Execution Logs:** Records of collection tasks performed (retained for 7 days).
    *   **Encrypted Screenshot Data:** Temporarily stored screenshots related to tasks (retained for 24 hours).

### Information We Do Not Collect:

*   We do not collect personal information unrelated to the extension's core functionality.
*   We do not track your general browsing history. Data is only accessed for URLs you explicitly target with the extension.
*   We do not share your data with unrelated third parties.

### Required Permissions:

The extension requires the following Chrome permissions to function:

*   `storage`: To save your settings and encrypted credentials locally.
*   `tabs` / `activeTab`: To interact with your currently open tabs when you activate the extension.
*   `scripting`: To execute scripts on web pages for extracting DOM information and taking screenshots.
*   `offscreen`: To process screenshot data in an offscreen document.
*   `downloads`: To potentially save collected data or screenshots if such a feature is used.
*   `host_permissions` (`<all_urls>`): Necessary to inject content scripts into user-specified pages and communicate via WebSocket with your designated server.

## Data Usage

Collected information is used solely for the purpose of operating the MCP Web Content Collector:

*   **Content Extraction:** To identify and extract the specific web content you request.
*   **Screenshots:** To capture visual representations of web pages or elements as requested.
*   **Configuration:** To store your preferences and connection details locally.
*   **Communication:** To securely transmit task data between the extension and your designated MCP server via WebSocket.
*   **Logging:** To maintain temporary operational logs on the server for debugging and monitoring.

## Data Transmission and Storage

*   **WebSocket:** Communication between the extension and your MCP server is encrypted using TLS 1.3.
*   **Local Storage:** Configuration and AES-256 encrypted credentials are stored locally using `chrome.storage.local`.
*   **Server Storage:** Task logs and encrypted screenshots are stored temporarily on your designated MCP server as described above.
*   **In-Memory Processing:** Web content data is primarily processed in memory and released after processing.
*   **Hashing:** Sensitive data elements within the transmitted data may be hashed (e.g., using SHA-256) before transmission for added security, where appropriate.

## Third-Party Services

This extension is designed to work with your own instance of the MCP server. It does not transmit data to any other third-party services or external APIs.

## Security

We implement security measures to protect your data:

*   **Encryption:** TLS 1.3 for WebSocket communication and AES-256 for stored credentials.
*   **Limited Data Retention:** Server-side logs and screenshots are retained only temporarily.
*   **Standard Practices:** Adherence to Chrome extension security best practices.

## User Rights

You have control over your data:

*   **Permissions:** You can revoke extension permissions at any time via `chrome://extensions`.
*   **Local Data:** You can clear locally stored data (settings, credentials) through the extension's options page.
*   **Network Inspection:** You can use browser developer tools to inspect network requests made by the extension.

## Changes to This Policy

We may update this Privacy Policy occasionally. Significant changes will be communicated through the extension's update notes in the Chrome Web Store, and the "Last updated" date at the top of this policy will be revised.

## Contact Us

If you have any questions about this Privacy Policy or the extension's data practices, please contact the development team at `[Insert Your Contact Email or Support Website Here]`.

## Compliance

This extension aims to comply with the Chrome Web Store Developer Program Policies.

---

By using the MCP Web Content Collector extension, you agree to the terms outlined in this Privacy Policy.