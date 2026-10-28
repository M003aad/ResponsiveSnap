# Contributing

Thank you for helping improve ResponsiveSnap. This project uses plain JavaScript and CSS with no build-time framework.

## Reporting bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md). Include:

- browser and version;
- ResponsiveSnap version;
- target page and whether it is local or hosted;
- exact steps and expected versus actual behavior;
- console or extension errors and screenshots when useful.

Do not include secrets or private data. Review [SECURITY.md](SECURITY.md) for vulnerabilities.

## Proposing features

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md). Explain the user problem, preferred behavior, and any compatibility or privacy implications.

## Local development

1. Install Git and a Chromium-based browser (Chrome or Edge).
2. Clone the repository:

   ```sh
   git clone https://github.com/M003aad/ResponsiveSnap.git
   cd ResponsiveSnap
   ```

3. Install development dependencies:

   ```sh
   npm install
   ```

4. Load the repository root as an unpacked extension:
   - Open `chrome://extensions/` or `edge://extensions/`.
   - Enable **Developer mode**.
   - Choose **Load unpacked**.
   - Select the repository folder.
5. Reload the extension after source changes and refresh the target tab before testing.

No environment variables are required; do not create or commit `.env` files.

Run checks before opening a pull request:

```sh
npm run lint
npm run check
npm run build
```

The extension has no generated application build. `npm run build` produces `dist/responsivesnap.zip` for validation and packaging.

## Pull requests

- Keep changes focused and explain the problem and approach.
- Follow the existing two-space JavaScript/CSS style and include comments only when behavior is not clear.
- Update [README.md](README.md) and directly affected documentation.
- Preserve Manifest V3 compatibility and avoid adding broad permissions unless required.
- Test normal Chrome/Edge pages plus protected-page behavior when relevant.
- For UI changes, include screenshots or a brief recording and affected viewport sizes.
- Run all available checks and document any not run.
- Complete the [pull request template](.github/PULL_REQUEST_TEMPLATE.md).

By submitting a contribution, you agree that it may be distributed under the repository's AGPL-3.0 license.
