# Security

Do not commit or report credentials in a public issue. Sponsor tokens belong in server environment variables. NVIDIA provider credentials belong in Nightshift, never in the browser or this repository.

Production uses the Sites authentication boundary and stable account identity. Never deploy the raw built Worker directly to the public Internet while trusting arbitrary `oai-authenticated-user-*` headers. A direct local built-Worker test supplies synthetic headers only to emulate the trusted hosting platform.

All personal-record queries must include the authenticated user ID. Model output and source excerpts are untrusted. Neither may change numeric risk gates, SQL queries, provider URLs, credentials or authorization.

The public source is a production-oriented hackathon implementation, not a security certification. Before commercial launch, validate dependency updates, perform an external security review, configure operational monitoring and backups, and review licensed market-data use and investment-research obligations in the intended jurisdictions.
