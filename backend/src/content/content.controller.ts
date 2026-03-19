import { Controller, Get, Patch, Body, Query, UseGuards, Req, Res } from '@nestjs/common';
import { ContentService } from './content.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Request, Response } from 'express';

@Controller('content')
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Get('grades')
  getGrades() {
    return this.contentService.getGrades();
  }

  @Get('areas')
  getAreas() {
    return this.contentService.getAreas();
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  updateProfile(
    @Req() req: Request,
    @Body() body: { gradeLevel: string; schoolLevel: string; selectedAreas: string[] },
  ) {
    const userId = (req as any).userId as string;
    const accessToken = (req as any).accessToken as string;
    return this.contentService.updateStudentProfile(
      userId,
      accessToken,
      body.gradeLevel,
      body.schoolLevel,
      body.selectedAreas,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('bundle')
  getContentBundle(
    @Req() req: Request,
    @Query('area') area: string,
    @Query('grade') grade: string,
  ) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return this.contentService.getContentBundleManifest(baseUrl, area, grade);
  }

  @Get('bundle/download')
  async downloadBundle(
    @Query('area') area: string,
    @Query('grade') grade: string,
    @Query('version') version: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const bundle = await this.contentService.downloadContentBundle({
      area,
      gradeLevel: grade,
      version: Number(version),
      expires: Number(expires),
      signature,
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${bundle.fileName}"`);
    res.setHeader('X-Content-Hash', bundle.hashSha256);
    return bundle.buffer;
  }

  @UseGuards(JwtAuthGuard)
  @Get('assignments')
  getStudentAssignments(@Req() req: Request) {
    const userId = (req as any).userId as string;
    const accessToken = (req as any).accessToken as string;
    return this.contentService.getStudentAssignments(userId, accessToken);
  }
}
