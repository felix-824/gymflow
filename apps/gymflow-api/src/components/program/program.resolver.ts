import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ProgramService } from './program.service';
import { Programs, Program } from '../../libs/dto/program/program';
import {
	TrainerProgramsInquiry,
	AllProgramsInquiry,
	ProgramsInquiry,
	ProgramInput,
} from '../../libs/dto/program/program.input';
import { Roles } from '../auth/decorators/roles.decorator';
import { MemberType } from '../../libs/enums/member.enum';
import { UseGuards } from '@nestjs/common';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { Types } from 'mongoose';
type ObjectId = Types.ObjectId;
import { WithoutGuard } from '../auth/guards/without.guard';
import { shapeIntoMongoObjectId } from '../../libs/config';
import { ProgramUpdate } from '../../libs/dto/program/program.update';
import { OrdinaryInquiry } from '../../libs/dto/common/inquiry';
import { AuthGuard } from '../auth/guards/auth.guard';

@Resolver()
export class ProgramResolver {
	constructor(private readonly programService: ProgramService) {}

	@Roles(MemberType.TRAINER)
	@UseGuards(RolesGuard)
	@Mutation(() => Program)
	public async createProgram(
		@Args('input') input: ProgramInput,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Program> {
		console.log('Mutation: createProgram');
		return await this.programService.createProgram(memberId, input);
	}

	@UseGuards(WithoutGuard)
	@Query(() => Program)
	public async getProgram(@Args('programId') input: string, @AuthMember('_id') memberId: ObjectId): Promise<Program> {
		console.log('Query: getProgram');
		const programId = shapeIntoMongoObjectId(input);
		return await this.programService.getProgram(memberId, programId);
	}

	@Roles(MemberType.TRAINER)
	@UseGuards(RolesGuard)
	@Mutation(() => Program)
	public async updateProgram(
		@Args('input') input: ProgramUpdate,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Program> {
		console.log('Mutation: updateProgram');
		input._id = shapeIntoMongoObjectId(input._id);
		return await this.programService.updateProgram(memberId, input);
	}

	@UseGuards(WithoutGuard)
	@Query(() => Programs)
	public async getPrograms(
		@Args('input') input: ProgramsInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Programs> {
		console.log('Query: getPrograms');
		return await this.programService.getPrograms(memberId, input);
	}

	// Login qilgan memberning favorite qilgan programlarini pagination bilan olib keladi.
	@UseGuards(AuthGuard)
	@Query(() => Programs)
	public async getFavorites(
		@Args('input') input: OrdinaryInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Programs> {
		console.log('Query: getFavorites');
		return await this.programService.getFavorites(memberId, input);
	}

	// Login qilgan member oldin ko'rgan
	//  programlarini olib keladi.
	@UseGuards(AuthGuard)
	@Query(() => Programs)
	public async getVisited(
		@Args('input') input: OrdinaryInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Programs> {
		console.log('Query: getVisited');
		return await this.programService.getVisited(memberId, input);
	}

	// Login qilgan TRAINERning o'z programlarini olish
	@Roles(MemberType.TRAINER)
	@UseGuards(RolesGuard)
	@Query(() => Programs)
	public async getTrainerPrograms(
		@Args('input') input: TrainerProgramsInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Programs> {
		console.log('Query: getTrainerPrograms');
		return await this.programService.getTrainerPrograms(memberId, input);
	}

	// Login memberning target programga
	//  LIKE/UNLIKE bosish requestini servicega yuboradi
	@UseGuards(AuthGuard)
	@Mutation(() => Program)
	public async likeTargetProgram(
		@Args('programId') input: string,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Program> {
		console.log('Mutation: likeTargetProgram');
		const likeRefId = shapeIntoMongoObjectId(input);
		return await this.programService.likeTargetProgram(memberId, likeRefId);
	}

	/** ADMIN **/

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query(() => Programs)
	public async getAllProgramsByAdmin(@Args('input') input: AllProgramsInquiry): Promise<Programs> {
		console.log('Query: getAllProgramsByAdmin');
		return await this.programService.getAllProgramsByAdmin(input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Program)
	public async updateProgramByAdmin(@Args('input') input: ProgramUpdate): Promise<Program> {
		console.log('Mutation: updateProgramByAdmin');
		input._id = shapeIntoMongoObjectId(input._id);
		return await this.programService.updateProgramByAdmin(input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Program)
	public async removeProgramByAdmin(@Args('programId') input: string): Promise<Program> {
		console.log('Mutation: removeProgramByAdmin');
		const programId = shapeIntoMongoObjectId(input);
		return await this.programService.removeProgramByAdmin(programId);
	}
}
