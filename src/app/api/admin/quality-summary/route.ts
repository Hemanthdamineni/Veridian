import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const totalProducts = await prisma.product.count();
    const totalObservations = await prisma.priceObservation.count();
    
    // Count products with stale source verification (> 30 days old)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const staleProductsCount = await prisma.product.count({
      where: {
        updatedAt: {
          lt: thirtyDaysAgo,
        },
      },
    });

    return NextResponse.json({
      totalProducts,
      totalObservations,
      suspiciousPricesCount: 0,
      staleProductsCount,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch summary' }, { status: 500 });
  }
}
