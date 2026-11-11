Starting pictures for the ad banners.

Banners are now managed on the admin page (https://letsconvertpdf.com/admin).
Pictures uploaded there are stored on the server in DATA_DIR/ads-images and
served at /ads/<file>, next to the files in this folder. You don't need to add
files here or redeploy to change a banner any more.

Pictures must come from our own site: the Content Security Policy blocks
pictures from other domains, which also keeps sponsors from tracking our
visitors through their images.
