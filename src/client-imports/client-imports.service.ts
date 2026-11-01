import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../database.module';
import { clientImports, clients } from '../schema';
import { ClientsService } from '../clients/clients.service';
import { CreateClientImportDto } from './dto/create-client-import.dto';
import { AppendClientImportBatchDto } from './dto/append-client-import-batch.dto';

@Injectable()
export class ClientImportsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly clientsService: ClientsService,
  ) {}

  async create(dto: CreateClientImportDto, userId: string) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Enter an import name.');

    const [created] = await this.db
      .insert(clientImports)
      .values({ name, totalRows: dto.totalRows, createdBy: userId })
      .returning();
    if (!created) throw new Error('Unable to create client import.');
    return created;
  }

  async appendBatch(id: number, userId: string, dto: AppendClientImportBatchDto) {
    return this.db.transaction(async (tx) => {
      const [clientImport] = await tx
        .select()
        .from(clientImports)
        .where(eq(clientImports.id, id))
        .for('update');
      this.assertOwnedProcessingImport(clientImport, userId);

      if (dto.rows.length > clientImport.totalRows - clientImport.importedRows) {
        throw new BadRequestException('This batch exceeds the remaining rows for the import.');
      }

      const normalizedRows = dto.rows.map((row) => ({
        ...this.clientsService.normalizeClientInput(row),
        importId: id,
      }));
      await tx.insert(clients).values(normalizedRows);

      const importedRows = clientImport.importedRows + normalizedRows.length;
      const [updated] = await tx
        .update(clientImports)
        .set({ importedRows })
        .where(eq(clientImports.id, id))
        .returning();
      if (!updated) throw new Error('Unable to update client import progress.');
      return updated;
    });
  }

  async complete(id: number, userId: string) {
    return this.db.transaction(async (tx) => {
      const [clientImport] = await tx
        .select()
        .from(clientImports)
        .where(eq(clientImports.id, id))
        .for('update');
      this.assertOwnedProcessingImport(clientImport, userId);

      if (clientImport.importedRows !== clientImport.totalRows) {
        throw new BadRequestException('The import cannot be completed until all rows are processed.');
      }

      const [completed] = await tx
        .update(clientImports)
        .set({ status: 'completed', completedAt: new Date() })
        .where(eq(clientImports.id, id))
        .returning();
      if (!completed) throw new Error('Unable to complete client import.');
      return completed;
    });
  }

  async fail(id: number, userId: string) {
    return this.db.transaction(async (tx) => {
      const [clientImport] = await tx
        .select()
        .from(clientImports)
        .where(eq(clientImports.id, id))
        .for('update');
      this.assertOwnedProcessingImport(clientImport, userId);

      const [failed] = await tx
        .update(clientImports)
        .set({ status: 'failed', completedAt: new Date() })
        .where(and(eq(clientImports.id, id), eq(clientImports.createdBy, userId)))
        .returning();
      if (!failed) throw new Error('Unable to mark client import as failed.');
      return failed;
    });
  }

  private assertOwnedProcessingImport(
    clientImport: typeof clientImports.$inferSelect | undefined,
    userId: string,
  ): asserts clientImport is typeof clientImports.$inferSelect {
    if (!clientImport) throw new NotFoundException('Client import not found.');
    if (clientImport.createdBy !== userId) {
      throw new ForbiddenException('You cannot modify this client import.');
    }
    if (clientImport.status !== 'processing') {
      throw new BadRequestException('This client import is no longer processing.');
    }
  }
}
