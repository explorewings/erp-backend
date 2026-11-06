import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { ClientsService } from '../clients/clients.service';
import { DRIZZLE, DrizzleDb } from '../database.module';
import { ClientRow, CrmDealRow, clients, crmDeals, crmPipelineStages } from '../schema';
import { CrmUser } from './crm-access';
import { CrmService } from './crm.service';
import { CreateCrmDealDto } from './dto/create-deal.dto';
import { isUniqueViolation } from './db-errors';

/** Only the client fields a deal card needs. */
const dealClientColumns = {
  id: clients.id,
  name: clients.name,
  email: clients.email,
  phoneNumber: clients.phoneNumber,
  customFields: clients.customFields,
};

type DealClient = Pick<ClientRow, 'id' | 'name' | 'email' | 'phoneNumber' | 'customFields'>;

function toDealResponse(deal: CrmDealRow, client: DealClient) {
  return {
    id: deal.id,
    pipelineId: deal.pipelineId,
    stageId: deal.stageId,
    createdAt: deal.createdAt,
    updatedAt: deal.updatedAt,
    client: {
      id: client.id,
      name: client.name,
      email: client.email,
      phoneNumber: client.phoneNumber,
      customFields: client.customFields,
    },
  };
}

/**
 * Deals: a client's participation in one pipeline. Every method requires
 * access to the deal's pipeline (same rule as viewing the pipeline).
 */
@Injectable()
export class CrmDealsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly pipelines: CrmService,
    private readonly clientsService: ClientsService,
  ) {}

  async listDeals(pipelineId: number, user: CrmUser) {
    await this.pipelines.getVisiblePipeline(pipelineId, user);

    const rows = await this.db
      .select({ deal: crmDeals, client: dealClientColumns })
      .from(crmDeals)
      .innerJoin(clients, eq(clients.id, crmDeals.clientId))
      .where(eq(crmDeals.pipelineId, pipelineId))
      .orderBy(desc(crmDeals.createdAt), desc(crmDeals.id));

    return rows.map((row) => toDealResponse(row.deal, row.client));
  }

  /**
   * Creates a new client and its deal in the pipeline's first stage, in one
   * transaction: either both are saved or neither is.
   */
  async createDealWithClient(pipelineId: number, dto: CreateCrmDealDto, user: CrmUser) {
    await this.pipelines.getVisiblePipeline(pipelineId, user);
    const clientInput = this.clientsService.normalizeClientInput(dto.client);

    try {
      return await this.db.transaction(async (tx) => {
        const [firstStage] = await tx
          .select({ id: crmPipelineStages.id })
          .from(crmPipelineStages)
          .where(eq(crmPipelineStages.pipelineId, pipelineId))
          .orderBy(asc(crmPipelineStages.position), asc(crmPipelineStages.id))
          .limit(1);
        if (!firstStage) throw new BadRequestException('This pipeline has no stages.');

        const [client] = await tx.insert(clients).values(clientInput).returning(dealClientColumns);
        const [deal] = await tx
          .insert(crmDeals)
          .values({ clientId: client.id, pipelineId, stageId: firstStage.id })
          .returning();

        return toDealResponse(deal, client);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('This client is already in the pipeline.');
      }
      throw error;
    }
  }

  /** Moves a deal to another stage of the same pipeline. */
  async moveDeal(dealId: number, stageId: number, user: CrmUser) {
    const [existing] = await this.db
      .select({ pipelineId: crmDeals.pipelineId })
      .from(crmDeals)
      .where(eq(crmDeals.id, dealId))
      .limit(1);
    if (!existing) throw new NotFoundException('Deal not found.');
    await this.pipelines.getVisiblePipeline(existing.pipelineId, user);

    return this.db.transaction(async (tx) => {
      const [deal] = await tx.select().from(crmDeals).where(eq(crmDeals.id, dealId)).for('update');
      if (!deal) throw new NotFoundException('Deal not found.');

      const [stage] = await tx
        .select({ id: crmPipelineStages.id })
        .from(crmPipelineStages)
        .where(and(eq(crmPipelineStages.id, stageId), eq(crmPipelineStages.pipelineId, deal.pipelineId)))
        .limit(1);
      if (!stage) throw new BadRequestException('That stage does not belong to this deal’s pipeline.');

      const [updated] =
        deal.stageId === stageId
          ? [deal]
          : await tx
              .update(crmDeals)
              .set({ stageId, updatedAt: new Date() })
              .where(eq(crmDeals.id, dealId))
              .returning();

      const [client] = await tx
        .select(dealClientColumns)
        .from(clients)
        .where(eq(clients.id, updated.clientId))
        .limit(1);
      return toDealResponse(updated, client);
    });
  }
}
