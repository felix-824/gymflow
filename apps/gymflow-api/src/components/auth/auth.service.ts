import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { Model, isValidObjectId } from 'mongoose';
import { Member } from '../../libs/dto/member/member';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';

interface TokenClaims {
	sub?: unknown;
	_id?: unknown;
	memberType?: unknown;
}

@Injectable()
export class AuthService {
	constructor(
		private readonly jwtService: JwtService,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
	) {}
	async hashPassword(password: string): Promise<string> {
		return bcrypt.hash(password, await bcrypt.genSalt());
	}
	comparePasswords(password: string, hashed: string): Promise<boolean> {
		return bcrypt.compare(password, hashed);
	}
	async createToken(member: Member): Promise<string> {
		return this.jwtService.signAsync({ sub: member._id.toHexString() });
	}
	async verifyToken(token: string): Promise<Member> {
		try {
			const claims = await this.jwtService.verifyAsync<TokenClaims>(token);
			const id = claims.sub ?? claims._id;
			if (
				typeof id !== 'string' ||
				!isValidObjectId(id) ||
				(claims.memberType !== undefined &&
					(typeof claims.memberType !== 'string' || !Object.values<string>(MemberType).includes(claims.memberType)))
			)
				throw new Error('Invalid claims');
			const member = await this.memberModel.findOne({ _id: id, memberStatus: MemberStatus.ACTIVE }).lean().exec();
			if (!member || !Object.values(MemberType).includes(member.memberType)) throw new Error('Inactive account');
			return member;
		} catch {
			throw new UnauthorizedException('Please sign in with an active account');
		}
	}
}
