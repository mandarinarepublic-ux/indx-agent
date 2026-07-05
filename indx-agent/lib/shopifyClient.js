// lib/shopifyClient.js — INDx Agent
// Cliente directo a Shopify Admin API (GraphQL) — solo IND Store

const SHOP         = process.env.IND_SHOPIFY_SHOP;
const CLIENT_ID    = process.env.IND_SHOPIFY_CLIENT_ID;
const CLIENT_SECRET= process.env.IND_SHOPIFY_CLIENT_SECRET;
const STORE_URL    = 'https://indlovers.com';

let cachedToken    = null;
let tokenExpiresAt = 0;

export function isConfigured() {
  return Boolean(SHOP && CLIENT_ID && CLIENT_SECRET);
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

  const res = await fetch(
    `https://${SHOP}.myshopify.com/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
      signal: AbortSignal.timeout(5000)
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify token falló: HTTP ${res.status} — ${text}`);
  }

  const { access_token, expires_in } = await res.json();
  cachedToken    = access_token;
  tokenExpiresAt = Date.now() + expires_in * 1000;
  return cachedToken;
}

async function graphql(query, variables = {}) {
  if (!isConfigured()) throw new Error('Shopify IND no configurado (faltan env vars)');

  const token = await getToken();
  const res   = await fetch(
    `https://${SHOP}.myshopify.com/admin/api/2026-01/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type':          'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(8000)
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify GraphQL falló: HTTP ${res.status} — ${text}`);
  }

  const { data, errors } = await res.json();
  if (errors?.length) throw new Error(`Shopify GraphQL errors: ${JSON.stringify(errors)}`);
  return data;
}

export async function buscarProductosDirecto(keyword) {
  const query = `
    query buscarProductos($q: String!) {
      products(first: 5, query: $q, sortKey: UPDATED_AT, reverse: true) {
        edges {
          node {
            title
            handle
            descriptionHtml
            images(first: 1) { edges { node { url } } }
            options { name values }
            variants(first: 10) {
              edges {
                node {
                  price
                  compareAtPrice
                  inventoryQuantity
                  availableForSale
                }
              }
            }
          }
        }
      }
    }
  `;

  const data  = await graphql(query, { q: keyword });
  const edges = data.products.edges;

  if (edges.length === 0) return { productos: null, count: 0 };

  const lineas = edges.map(({ node }) => {
    const variantePrincipal = node.variants.edges[0]?.node;
    const precio            = variantePrincipal?.price || '?';
    const precioComparacion = variantePrincipal?.compareAtPrice;
    const descuentoTexto    = precioComparacion && precioComparacion !== precio
      ? ` (antes ${precioComparacion})`
      : '';
    const tallas     = node.options.map(o => `${o.name}: ${o.values.join(' / ')}`).join(' | ');
    const imagen     = node.images.edges[0]?.node.url || '';
    const descripcion= (node.descriptionHtml || '').replace(/<[^>]*>/g, '').trim().slice(0, 200);
    const url        = `${STORE_URL}/products/${node.handle}`;

    return `PRODUCTO: ${node.title} | PRECIO: ${precio}${descuentoTexto} | TALLAS: ${tallas} | IMAGEN: ${imagen} | URL: ${url} | DESCRIPCION: ${descripcion}`;
  });

  return { productos: lineas.join(' ||| '), count: edges.length };
}
