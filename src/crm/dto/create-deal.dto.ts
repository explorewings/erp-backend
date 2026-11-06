import { Type } from 'class-transformer';
import { IsDefined, ValidateNested } from 'class-validator';
import { CreateClientDto } from '../../clients/dto/create-client.dto';

/** Creates a new client and adds it to the pipeline as a deal. */
export class CreateCrmDealDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => CreateClientDto)
  client!: CreateClientDto;
}
