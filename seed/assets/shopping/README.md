# Shopping seed images

`npm run seed:shopping` gives every demo product, store logo, store cover and
home banner an image. **No stock or scraped photos are used.** By default each
image is a *generated tile*: the store's brand colour, a simple pattern
(stripes, dots, waves or diamonds) and the product or store name, drawn as SVG
by `src/database/seeds/shopping/tiles.ts`. There is nothing to license.

## Where the images end up

| Situation | What the seed stores |
|---|---|
| `CLOUDINARY_*` set (and no `--placeholder-images`) | The tile (or your photo, below) is uploaded into the owning partner's own folder, `metromatrix/{env}/{userId}/{purpose}/seed-{store}-{name}`, and served as PNG (`f_png`). Because it lives in the partner's folder it passes the same ownership checks as the partner's own uploads. Re-running overwrites the same public ids. |
| No keys, or `--placeholder-images` | A deterministic `https://placehold.co/…/png?text=…` URL in the brand colours. **Development only** — the seed refuses this in production unless you pass `--placeholder-images` on purpose (e.g. the local production-image rehearsal). |

## Using real photos

Only add photos you took yourself or hold a licence for (keep the licence with
the photo). Name each file after the product slug and put it in its store's
folder:

```
seed/assets/shopping/
  fashion/embroidered-lawn-kurta.jpg
  beauty/vitamin-c-serum.png
  home/cast-iron-karahi.webp
  handmade/multani-blue-pottery-vase.jpg
```

Store keys: `fashion` (Lahore Loom), `beauty` (Glow Theory), `home` (Ghar Ghar
Home), `handmade` (Haath Kaari). Slugs are the product names lower-cased with
dashes — see `src/database/seeds/shopping/catalog-data.ts`. `logo` and
`cover` replace a store's logo and cover; `banner-1`…`banner-3` the banners.

A photo is used only when Cloudinary keys are set (it has to be uploaded to be
served). The seed only creates missing products, so to swap an existing
product's tile for a photo either edit the product in the partner app, or
reset the demo data and seed again.

## Demo accounts

The four store partners are `demo.<key>@metromatrix.test`, password
`SEED_DEMO_PASSWORD` from the environment (never committed). Sold counts on
demo products are synthetic so the "popular" sort has something to sort; there
are no fabricated reviews or ratings.
