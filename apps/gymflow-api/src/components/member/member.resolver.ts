import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { MemberService } from './member.service';
import { TrainersInquiry, LoginInput, MemberInput, MembersInquiry } from '../../libs/dto/member/member.input';
import { Member, Members, OwnerMember, PublicMember, PublicMembers } from '../../libs/dto/member/member';
import { UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { Types } from 'mongoose';
type ObjectId = Types.ObjectId;
import { Roles } from '../auth/decorators/roles.decorator';
import { MemberType } from '../../libs/enums/member.enum';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MemberSelfUpdate, MemberUpdate } from '../../libs/dto/member/member.update';
import { shapeIntoMongoObjectId } from '../../libs/config';
import { WithoutGuard } from '../auth/guards/without.guard';
import { GraphQLUpload } from 'graphql-upload';
import type { FileUpload } from 'graphql-upload';
import { saveUploadedImages } from '../../libs/upload';
import { AuthService } from '../auth/auth.service';
import { AuthToken } from '../../libs/dto/member/auth-token';
import type { GraphQLAuthContext } from '../../libs/types/auth-context';
import { UnauthorizedException } from '@nestjs/common';

@Resolver()
export class MemberResolver {
	//private readonly memberService: MemberService

	constructor(
		private readonly memberService: MemberService,
		private readonly authService: AuthService,
	) {}
	//this.memberService = new MemberService();

	@Mutation(() => OwnerMember)
	public async signup(@Args('input') input: MemberInput, @Context() context: GraphQLAuthContext): Promise<OwnerMember> {
		this.authService.assertAuthRequest(context.req);
		const member = await this.memberService.signup(input);
		const credentials = await this.authService.createSession(member);
		this.authService.setRefreshCookie(context.res, credentials);
		return { ...member, accessToken: credentials.accessToken };
	}
	@Mutation(() => OwnerMember)
	public async login(@Args('input') input: LoginInput, @Context() context: GraphQLAuthContext): Promise<OwnerMember> {
		this.authService.assertAuthRequest(context.req);
		const member = await this.memberService.login(input);
		const credentials = await this.authService.createSession(member);
		this.authService.setRefreshCookie(context.res, credentials);
		return { ...member, accessToken: credentials.accessToken };
	}

	@Mutation(() => AuthToken)
	public async refreshSession(@Context() context: GraphQLAuthContext): Promise<AuthToken> {
		this.authService.assertAuthRequest(context.req);
		try {
			const credentials = await this.authService.refreshSession(this.authService.readRefreshCookie(context.req));
			this.authService.setRefreshCookie(context.res, credentials);
			return { accessToken: credentials.accessToken };
		} catch (error) {
			if (error instanceof UnauthorizedException) this.authService.clearRefreshCookie(context.res);
			throw error;
		}
	}

	@Mutation(() => Boolean)
	public async logoutSession(@Context() context: GraphQLAuthContext): Promise<boolean> {
		this.authService.assertAuthRequest(context.req);
		try {
			await this.authService.logoutSession(
				this.authService.readRefreshCookie(context.req),
				/^Bearer (\S+)$/i.exec(context.req.headers.authorization ?? '')?.[1],
			);
			return true;
		} finally {
			this.authService.clearRefreshCookie(context.res);
		}
	}

	@UseGuards(AuthGuard)
	@Mutation(() => OwnerMember)
	public async updateMember(
		@Args('input') input: MemberSelfUpdate,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<OwnerMember> {
		console.log('Mutation: updateMember');

		return await this.memberService.updateMember(memberId, input);
	}

	@UseGuards(AuthGuard)
	@Query(() => String)
	public checkAuth(@AuthMember('memberNick') memberNick: string): string {
		console.log('Query: checkAuth');
		return `Hi ${memberNick}`;
	}

	@Roles(MemberType.USER, MemberType.TRAINER)
	@UseGuards(RolesGuard)
	@Query(() => String)
	public checkAutRoles(@AuthMember() authMember: Member): string {
		console.log('Query: checkAutRoles');
		return `Hi ${authMember.memberNick}, you are ${authMember.memberType} (memberId: ${authMember._id.toHexString()})`;
	}

	@UseGuards(AuthGuard)
	@Query(() => OwnerMember)
	public async getMyMember(@AuthMember('_id') memberId: ObjectId): Promise<OwnerMember> {
		return await this.memberService.getMyMember(memberId);
	}

	@UseGuards(WithoutGuard)
	@Query(() => PublicMember)
	public async getMember(
		@Args('memberId') input: string,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<PublicMember> {
		console.log('Query: getMember');
		const targetId = shapeIntoMongoObjectId(input);
		return await this.memberService.getPublicMember(memberId, targetId);
	}

	@UseGuards(WithoutGuard)
	@Query(() => PublicMembers)
	public async getTrainers(
		@Args('input') input: TrainersInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<PublicMembers> {
		console.log('Query: getTrainers');
		return await this.memberService.getTrainers(memberId, input);
	}

	//Login qilgan member
	// boshqa bir memberga like bosishi.
	@UseGuards(AuthGuard)
	@Mutation(() => PublicMember)
	public async likeTargetMember(
		@Args('memberId') input: string,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<PublicMember> {
		console.log('Mutation: likeTargetMember');
		const likeRefId = shapeIntoMongoObjectId(input);
		return await this.memberService.likeTargetMember(memberId, likeRefId);
	}

	/** ADMIN */

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query(() => Members)
	public async getAllMembersByAdmin(@Args('input') input: MembersInquiry): Promise<Members> {
		console.log('Query: getAllMembersByAdmin');
		return await this.memberService.getAllMembersByAdmin(input);
	}

	//Authorization: ADMIN
	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Member)
	public async updateMemberByAdmin(@Args('input') input: MemberUpdate): Promise<Member> {
		console.log('Mutation: updateMemberByAdmin');
		return await this.memberService.updateMemberByAdmin(input);
	}

	//** UPLOADER **/

	@UseGuards(AuthGuard)
	@Mutation(() => String)
	public async imageUploader(
		@Args({ name: 'file', type: () => GraphQLUpload }) file: Promise<FileUpload> | FileUpload,
		@Args('target') target: string,
		@AuthMember('memberType') memberType: MemberType,
	): Promise<string> {
		const images = await saveUploadedImages([file], target, memberType);
		return images[0];
	}

	@UseGuards(AuthGuard)
	@Mutation(() => [String])
	public async imagesUploader(
		@Args('files', { type: () => [GraphQLUpload] }) files: Promise<FileUpload>[],
		@Args('target') target: string,
		@AuthMember('memberType') memberType: MemberType,
	): Promise<string[]> {
		return await saveUploadedImages(files, target, memberType);
	}
}
