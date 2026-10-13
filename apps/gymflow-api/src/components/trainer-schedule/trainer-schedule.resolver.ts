import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Types } from 'mongoose';
import { TrainerSchedule } from '../../libs/dto/trainer-schedule/trainer-schedule';
import { TrainerScheduleInput } from '../../libs/dto/trainer-schedule/trainer-schedule.input';
import { MemberType } from '../../libs/enums/member.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TrainerScheduleService } from './trainer-schedule.service';

@Resolver()
export class TrainerScheduleResolver {
	constructor(private readonly trainerScheduleService: TrainerScheduleService) {}

	@Roles(MemberType.TRAINER)
	@UseGuards(RolesGuard)
	@Query(() => [TrainerSchedule])
	public async getMyTrainerSchedule(@AuthMember('_id') memberId: Types.ObjectId): Promise<TrainerSchedule[]> {
		return await this.trainerScheduleService.getMyTrainerSchedule(memberId);
	}

	@Roles(MemberType.TRAINER)
	@UseGuards(RolesGuard)
	@Mutation(() => [TrainerSchedule])
	public async saveMyTrainerSchedule(
		@Args('input') input: TrainerScheduleInput,
		@AuthMember('_id') memberId: Types.ObjectId,
	): Promise<TrainerSchedule[]> {
		return await this.trainerScheduleService.saveMyTrainerSchedule(memberId, input);
	}
}
