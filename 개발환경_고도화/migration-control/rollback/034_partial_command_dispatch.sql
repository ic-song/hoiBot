DROP TABLE IF EXISTS command_routing_decisions;
DROP TABLE IF EXISTS command_aliases;
DROP TABLE IF EXISTS command_registry;

DELETE FROM schema_migrations
 WHERE version = '034_partial_command_dispatch.sql';
