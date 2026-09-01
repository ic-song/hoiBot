import type { DatabaseClient } from "../database.js";

export interface DeveloperNoteDeploymentEntry {
  sourceOrder: number;
  version: string;
  releasedOn: string;
  contentHash: string;
  changes: string[];
}

export interface DeveloperNoteDeploymentCatalog {
  catalogVersion: string;
  sourceRevision: string;
  sourcePath: string;
  sourceSha256: string;
  mainSha256: string;
  latestNoteVersion: string;
  deployedBotVersion: string;
  deploymentCommit: string;
  publicationStatus: "SHADOW" | "PUBLISHED" | "RETIRED";
  entries: DeveloperNoteDeploymentEntry[];
}

interface CatalogRow {
  id: bigint; catalog_version: string; source_revision: string; source_path: string; source_sha256: string; main_sha256: string;
  entry_count: number | bigint; change_count: number | bigint; latest_note_version: string; deployed_bot_version: string;
  deployment_commit: string; publication_status: DeveloperNoteDeploymentCatalog["publicationStatus"];
}
interface EntryRow { source_order: number | bigint; version: string; released_on: string | Date; content_hash: string; change_index: number | bigint; change_text: string; }

// 동결된 개발자노트 원문과 배포 버전의 불변 연결을 순서대로 조회합니다.
export class MariaDeveloperNoteDeploymentCatalogProvider {
  constructor(private readonly database: Pick<DatabaseClient, "query">) {}

  async readCatalog(catalogVersion: string): Promise<DeveloperNoteDeploymentCatalog | null> {
    const catalogs = await this.database.query<CatalogRow[]>(`SELECT id,catalog_version,source_revision,source_path,source_sha256,main_sha256,entry_count,change_count,latest_note_version,deployed_bot_version,deployment_commit,publication_status FROM developer_note_deployment_catalogs WHERE catalog_version=?`, [catalogVersion]);
    const catalog = catalogs[0];
    if (catalog === undefined) return null;
    if (catalogs.length !== 1) throw new Error("DEVELOPER_NOTE_DEPLOYMENT_CATALOG_AMBIGUOUS");
    const rows = await this.database.query<EntryRow[]>(`SELECT binding.source_order,entry.version,DATE_FORMAT(entry.released_on,'%Y-%m-%d') released_on,binding.content_hash,change_row.change_index,change_row.change_text FROM developer_note_deployment_entries binding JOIN developer_note_entries entry ON entry.id=binding.developer_note_entry_id JOIN developer_note_changes change_row ON change_row.entry_id=entry.id WHERE binding.deployment_catalog_id=? ORDER BY binding.source_order,change_row.change_index`, [catalog.id]);
    const entries: DeveloperNoteDeploymentEntry[] = [];
    for (const row of rows) {
      const sourceOrder = Number(row.source_order);
      let entry = entries[entries.length - 1];
      if (entry?.sourceOrder !== sourceOrder) {
        entry = { sourceOrder, version: row.version, releasedOn: String(row.released_on), contentHash: row.content_hash, changes: [] };
        entries.push(entry);
      }
      if (Number(row.change_index) !== entry.changes.length) throw new Error("DEVELOPER_NOTE_CHANGE_ORDER_GAP");
      entry.changes.push(row.change_text);
    }
    if (entries.length !== Number(catalog.entry_count) || rows.length !== Number(catalog.change_count) || entries.length !== 325 || rows.length !== 499) throw new Error("DEVELOPER_NOTE_DEPLOYMENT_COUNT_MISMATCH");
    for (let index = 0; index < entries.length; index++) if (entries[index]!.sourceOrder !== index + 1) throw new Error("DEVELOPER_NOTE_SOURCE_ORDER_GAP");
    if (entries[0]!.version !== catalog.latest_note_version || catalog.latest_note_version !== catalog.deployed_bot_version) throw new Error("DEVELOPER_NOTE_DEPLOYMENT_VERSION_MISMATCH");
    return { catalogVersion: catalog.catalog_version, sourceRevision: catalog.source_revision, sourcePath: catalog.source_path, sourceSha256: catalog.source_sha256, mainSha256: catalog.main_sha256, latestNoteVersion: catalog.latest_note_version, deployedBotVersion: catalog.deployed_bot_version, deploymentCommit: catalog.deployment_commit, publicationStatus: catalog.publication_status, entries };
  }
}
