# Contributing to Veridian

Welcome to the Veridian project! We are building a trusted decision platform for laptops. Whether you are fixing a bug, adding a new scraper, or improving our UI, we appreciate your help.

## 🚀 Quick Start

1.  **Fork & Clone:**
    ```bash
    git clone https://github.com/your-username/veridian.git
    cd veridian/veridian-web
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Environment Setup:**
    Copy the example env file and configure your local database (PostgreSQL):
    ```bash
    cp .env.example .env.local
    # Edit .env.local with your DATABASE_URL
    ```

4.  **Initialize Database:**
    ```bash
    npx prisma generate
    npx prisma db push
    npx prisma db seed
    ```

5.  **Run Locally:**
    ```bash
    npm run dev
    ```

## 🛠 Development Workflow

### Branching Strategy
- `main`: The stable, production-ready branch.
- `develop`: Integration branch for upcoming features.
- `feature/<name>`: For new features (branch off `develop`).
- `fix/<name>`: For bug fixes (branch off `main` or `develop`).

### Code Style
- **TypeScript**: We use strict TypeScript. No `any` types unless absolutely necessary.
- **Linting**: We use ESLint. Run `npm run lint` before committing.
- **Formatting**: Follow the existing code patterns. We use Tailwind CSS for all styling—avoid inline styles.

### Commit Messages
We follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification:
- `feat: Add new price alert engine`
- `fix: Correct weight filtering for sub-1kg models`
- `docs: Update architecture overview`
- `refactor: Simplify Prisma query for SKU list`

## 📦 Project Specifics

### Database Changes
If you modify the Prisma schema (`prisma/schema.prisma`):
1.  Update the schema.
2.  Run `npx prisma db push` to sync with your local DB.
3.  If you are adding a new model, ensure you add a seed entry in `scripts/seed.ts` or a new CSV file in `data/`.

### Adding a New Scraper
Scraper configurations are managed via YAML in `veridian-scraper/configs/`.
1.  Add a new YAML file for the retailer/manufacturer.
2.  Follow the existing schema in the `veridian-scraper` documentation.
3.  Test your scraper locally before submitting a PR.

## 🐛 Reporting Issues
- Use the GitHub Issues tab.
- Provide as much detail as possible: steps to reproduce, expected behavior, and actual behavior.
- For UI bugs, a screenshot is incredibly helpful.

## 📜 License
By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
