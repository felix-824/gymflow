import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import { ProgramAvailabilityInquiry } from '../../libs/dto/availability/availability.input';
import { AvailableSlot } from '../../libs/dto/availability/availability';
import { WithoutGuard } from '../auth/guards/without.guard';
import { AvailabilityService } from './availability.service';

@Resolver()
export class AvailabilityResolver {
	constructor(private readonly availabilityService: AvailabilityService) {}

	@UseGuards(WithoutGuard)
	@Query(() => [AvailableSlot])
	public async getProgramAvailability(@Args('input') input: ProgramAvailabilityInquiry): Promise<AvailableSlot[]> {
		return await this.availabilityService.getProgramAvailability(input);
	}
}
