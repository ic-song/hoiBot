# SL-ASSET-PET-SKILL-DEFINITION-SEED-01

- catalog_version: ASSET-FREEZE-v2.400-a286279b-01
- baseline: 48356607bcf97702084db3cf07050fdd46314e72
- WBS: 611
- DB mapping: 1886
- Lease: 2351
- migration: 390_pet_skill_definition_seed.sql
- source: PET_SKILL_LIST 90 / hash 595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f
- mapping: exact existing 15 / new 75 / final skill_definitions 93
- identity: 십원·구원은 pet_skill_*에 연결하고 trial_*는 별도 보존
- preserved: SL-PET-SKILL-READ Gate 1~7, pet_skill_inventory, pet_skills, ledger
- excluded: legacy main.js 수정, Gate 8, feature/prod, 운영 DB
