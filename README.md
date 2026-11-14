# DDNet-AI route packs

Ready gores routes for the DDNet-AI bot. A bot on a gores map it has no route for downloads
`gores/<map key>.v<version>.grp` from this branch, replays every section on its own simulator,
and plays the route only if the replay agrees with the file. Nothing in a pack is executed; a pack
that does not replay is thrown away and the bot solves the map itself.

The files are binary (see `src/plan/goresPack.ts` in the bot for the format). They are made with
`tools/goresPackExport.ts`, which writes a pack only after it verifies on its map.

| file | map | route |
|---|---|---|
| fd4ae7e61f8d11883b2a85a9a12e1269.v5.grp | AiP-Gores | 112.0 s |
| e5fcec503608a457b855bfde6efff005.v5.grp | Gradzes | 54.4 s |
| cdb5ec0623e02ffc5d9af93d75f702ae.v5.grp | Mimixi | 93.1 s |
| ad65d27f31e6bcb0bf860a8d8698c64a.v5.grp | Corazon4Drakenmake | 130.0 s |

These routes have had no polish pass yet: the bot runs the passes itself and switches to a faster
route when it finds one.
