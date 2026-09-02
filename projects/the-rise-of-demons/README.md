# The Rise of Demons — Social Teaser

Status: active

The current delivery is [output/final.mp4](output/final.mp4). It is a 9.2-second vertical dark-fantasy book teaser using the supplied battle artwork and book cover without regeneration.

Render a revision:

```bash
npm run video -- render projects/the-rise-of-demons/source/campaign.yaml --final --change "describe the change"
npm run video -- verify-render projects/the-rise-of-demons/source/campaign.yaml latest
```

`source/` holds the durable campaign material and production record. `output/` holds the numbered render lineage and the current `final.mp4` delivery.
