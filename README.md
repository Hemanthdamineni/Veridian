# Veridian

> A trusted decision platform for laptops — not just specs, but verified, connected, decision-ready data.

Veridian is an open-source project aimed at building a comprehensive, structured database of current-generation ultrabooks. Our goal is to provide a single source of truth that lets users find laptops matching hard spec constraints faster and more precisely than searching manufacturer sites or retailers separately.

## Vision

While the MVP focuses on a filterable catalog of specs, the long-term vision includes:
- **Price Intelligence:** Real-time price tracking, historical trends, and alerts across major retailers.
- **AI-Powered Discovery:** Natural language filtering ("quiet laptop for programming under ₹90k") and AI-driven recommendations.
- **Community-Driven Data:** A reputation system for users to contribute corrections, evidence, and verified reviews.
- **Cross-Retailer Identity:** A resolution pipeline that matches raw retailer listings to our canonical SKU database.

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend & API** | Next.js 14 (App Router) |
| **Language** | TypeScript |
| **Database** | PostgreSQL 16 (hosted on Neon) |
| **ORM** | Prisma |
| **Styling** | Tailwind CSS v4 |
| **Search** | Meilisearch (planned for v2+) |
| **Deployment** | Vercel |

## Project Structure

- `/veridian-web`: The main Next.js application (UI + API routes).
- `/veridian-scraper`: Data collection scripts and scraper fleet for manufacturer specs.
- `/docs`: Technical specifications, research, and engineering architecture.
- `Veridian-spec.md`: The full system specification (MVP and Final Product).

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL database (Neon is recommended for easy setup)

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/veridian.git
    cd veridian
    ```

2.  **Install dependencies (for the web app):**
    ```bash
    cd veridian-web
    npm install
    ```

3.  **Configure Environment:**
    Copy the example env file and set your database URL:
    ```bash
    cp .env.example .env.local
    # Edit .env.local with your DATABASE_URL and ADMIN_TOKEN
    ```

4.  **Initialize Database:**
    ```bash
    npx prisma generate
    npx prisma db push
    npx prisma db seed
    ```

5.  **Run the Development Server:**
    ```bash
    npm run dev
    ```
    Open [http://localhost:3000](http://localhost:3000) to see the application.

## Roadmap

We are building in phases. Check our [ROADMAP.md](./ROADMAP.md) for the latest status on:
1.  **MVP Launch:** Filterable catalog with 50+ SKUs.
2.  **Data Pipeline:** Hardened scrapers for 14 manufacturers.
3.  **Price Intelligence:** Tracking, history, and alerts.
4.  **AI & Search:** Recommendations and smart filters.

## Contributing

We welcome contributions! Please read our [CONTRIBUTING.md](./CONTRIBUTING.md) to get started with our setup and coding standards.

## License

MIT
