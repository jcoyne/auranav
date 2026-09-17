# Architecture

See `PLAN.md` for milestones and `schema/` for the interface between chart preprocessing and display.

Downloaded S-57 exchange sets enter the pipeline as immutable source inputs. Processing applies sequential updates, extracts the supported object classes, preserves cell metadata, and emits vector tiles plus a manifest. The webapp reads only the manifest and tiles. It does not parse S-57 data.

Generated packages should be written beneath `data/packages/` during development. Nothing beneath `data/`, except `.gitkeep`, belongs in version control.
