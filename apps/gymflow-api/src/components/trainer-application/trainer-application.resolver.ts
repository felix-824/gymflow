import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Types } from 'mongoose';
import { TrainerApplication } from '../../libs/dto/trainer-application/trainer-application';
import { TrainerApplicationInput } from '../../libs/dto/trainer-application/trainer-application.input';
import { MemberType } from '../../libs/enums/member.enum';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TrainerApplicationService } from './trainer-application.service';

@Resolver()
export class TrainerApplicationResolver {
	constructor(private readonly trainerApplicationService: TrainerApplicationService) {}

	@Roles(MemberType.USER)
	@UseGuards(RolesGuard)
	@Mutation(() => TrainerApplication)
	public async submitTrainerApplication(
		@Args('input') input: TrainerApplicationInput,
		@AuthMember('_id') memberId: Types.ObjectId,
	): Promise<TrainerApplication> {
		return await this.trainerApplicationService.submitTrainerApplication(memberId, input);
	}

	@UseGuards(AuthGuard)
	@Query(() => TrainerApplication, { nullable: true })
	public async getMyTrainerApplication(
		@AuthMember('_id') memberId: Types.ObjectId,
	): Promise<TrainerApplication | null> {
		return await this.trainerApplicationService.getMyTrainerApplication(memberId);
	}
}
