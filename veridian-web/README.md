# Veridian Web

A trusted decision platform for laptops — not just specs, but verified, connected, decision-ready data.

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Database:** PostgreSQL (Neon)
- **ORM:** Prisma
- **Styling:** Tailwind CSS v4

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database (Neon recommended)

### Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your database URL and admin token
   ```

3. **Generate Prisma client:**
   ```bash
   npm run db:generate
   ```

4. **Push schema to database:**
   ```bash
   npm run db:push
   ```

5. **Seed initial data:**
   ```bash
   npm run db:seed
   ```

6. **Run development server:**
   ```bash
   npm run dev
   ```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:push` | Push schema to database |
| `npm run db:migrate` | Run migrations |
| `npm run db:seed` | Seed database with CSV data |
| `npm run db:studio` | Open Prisma Studio |

## Project Structure

```
veridian-web/
├── data/
│   └── laptops.csv          # Initial dataset (50+ SKUs)
├── prisma/
│   └── schema.prisma        # Database schema
├── public/                  # Static assets
├── scripts/
│   └── seed.ts              # Database seed script
├── src/
│   ├── app/
│   │   ├── admin/           # Admin route
│   │   ├── api/             # API routes
│   │   │   ├── admin/       # Admin API
│   │   │   ├── manufacturers/
│   │   │   └── skus/
│   │   ├── skus/[id]/       # SKU detail page
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx         # Home page with filters
│   ├── components/
│   │   ├── admin/           # Admin components
│   │   ├── FilterPanel.tsx
│   │   ├── Pagination.tsx
│   │   └── SkuCard.tsx
│   ├── lib/
│   │   ├── api.ts           # API utilities
│   │   └── db.ts            # Prisma client
│   └── types/
│       ├── index.ts         # Shared types
│       └── prisma.ts        # Prisma types
├── .env.example
├── .env.local
├── next.config.mjs
├── package.json
├── tsconfig.json
└── README.md
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/skus` | List SKUs with filters |
| `GET /api/skus/:id` | Get SKU detail |
| `GET /api/manufacturers` | List manufacturers |
| `POST /api/admin/skus` | Create SKU (admin) |

## Filter Parameters

| Param | Type | Description |
|-------|------|-------------|
| `cpu_brand` | string | Comma-separated: Intel,AMD,Qualcomm,Apple |
| `ram_min` | int | Minimum RAM in GB |
| `storage_min` | int | Minimum storage in GB |
| `display_type` | string | Comma-separated: IPS,OLED,Mini-LED |
| `refresh_min` | int | Minimum refresh rate |
| `weight_max` | float | Maximum weight in kg |
| `battery_min` | float | Minimum battery in Wh |
| `touch` | boolean | Touch display filter |
| `region` | string | US,IN,UK,EU,CA |
| `price_min` | float | Minimum price (requires region) |
| `price_max` | float | Maximum price (requires region) |
| `q` | string | Search query |
| `sort` | string | price_asc,price_desc,weight_asc,battery_desc,newest |
| `page` | int | Page number |
| `limit` | int | Items per page (max 100) |

## Deployment

### Vercel

1. Connect your GitHub repo to Vercel
2. Set environment variables:
   - `DATABASE_URL`: Your Neon connection string
   - `ADMIN_TOKEN`: A secure random string
3. Deploy

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `ADMIN_TOKEN` | Bearer token for admin routes |
| `NEXT_PUBLIC_BASE_URL` | Base URL for API fetches (optional) |

## License

MIT
