# PackWise Compliance

Create a modern, professional, responsive web application for the following Smart India Hackathon problem statement:

“Software System to Check Compliance of Packaged Commodities under the Legal Metrology (Packaged Commodities) Rules, 2011 by Scanning Products, Images and Labels.”

The purpose of the system is to help users automatically verify whether the information printed on a packaged commodity label complies with the required Legal Metrology declarations.

Design the application as a professional government/enterprise-level compliance platform. The user interface should be clean, trustworthy, modern, and easy to understand. Avoid making it look like a simple chatbot or student project.

Main Features

Home Page

A professional landing page explaining the purpose of the platform.

A clear headline such as: “Automated Packaged Commodity Compliance Checker”.

Briefly explain how AI and image scanning can help check product labels for compliance.

Include a “Scan Product” call-to-action button.

Include a simple “How It Works” section with:

Upload or scan product image

Extract label information using OCR

Analyze declarations against compliance requirements

Generate a detailed compliance report

Product Scanning Page

Allow users to upload one or multiple images of a packaged product or its label.

Support drag-and-drop image upload.

Provide a camera/scan option where supported.

Show image preview before analysis.

Include a prominent “Analyze Compliance” button.

Analysis Processing

Create a loading/progress screen showing steps such as:

Image processing

Text extraction

Label information detection

Compliance verification

Report generation

Compliance Results Dashboard

Display extracted information from the product label.

Show each compliance requirement separately with status indicators:

Compliant

Non-Compliant

Warning / Needs Manual Verification

Display an overall compliance score or status.

Clearly highlight missing or suspicious declarations.

Provide a detailed explanation for every failed compliance check.

Include a downloadable compliance report section.

History Dashboard

Show previously analyzed products.

Include product image thumbnail, date of analysis, and compliance status.

Add search and filtering options.

Admin/Authority Dashboard

Design a separate dashboard concept for authorities or administrators.

Show statistics such as:

Total products analyzed

Compliant products

Non-compliant products

Most common violations

Include simple charts and analytics.

Important Design Requirements

Use a modern, responsive layout suitable for desktop and mobile.

Use a clean and trustworthy professional design appropriate for a government compliance technology platform.

Use clear icons and visual status indicators.

Include accessibility-friendly typography and readable layouts.

Avoid excessive animations and unnecessary design elements.

The application should feel like a real production-ready software platform.

Use dummy/sample data initially so the complete workflow can be demonstrated.

Build the application with a clean component structure so that OCR, image recognition, and compliance-checking APIs can be integrated later.

Core Workflow

Product Image / Label Upload
→ OCR and Image Processing
→ Extract Product Declarations
→ Compare Information with Legal Metrology (Packaged Commodities) Rules, 2011
→ Identify Missing or Incorrect Information
→ Generate Compliance Status and Detailed Report

Create all required pages, navigation, buttons, cards, dashboards, upload components, and sample compliance reports. The final prototype should be visually impressive and suitable for demonstration at the Smart India Hackathon.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://checkr-legal-insight.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/4cf82fa0-1907-4391-a660-903c0867d5a6).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
