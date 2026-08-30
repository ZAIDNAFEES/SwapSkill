import 'package:flutter/material.dart';
import '../constants/app_colors.dart';
import '../constants/app_typography.dart';

enum SkillChipType { teach, learn, category, neutral }

class SkillChip extends StatelessWidget {
  final String label;
  final SkillChipType type;
  final VoidCallback? onDeleted;
  final VoidCallback? onTap;
  final bool isSelected;

  const SkillChip({
    super.key,
    required this.label,
    this.type = SkillChipType.neutral,
    this.onDeleted,
    this.onTap,
    this.isSelected = false,
  });

  @override
  Widget build(BuildContext context) {
    Color bg;
    Color text;
    BorderSide border = BorderSide.none;

    switch (type) {
      case SkillChipType.teach:
        bg = AppColors.teachBadgeBg;
        text = AppColors.teachBadgeText;
        break;
      case SkillChipType.learn:
        bg = AppColors.learnBadgeBg;
        text = AppColors.learnBadgeText;
        break;
      case SkillChipType.category:
        bg = isSelected ? AppColors.primary : AppColors.surface;
        text = isSelected ? Colors.white : AppColors.textSecondary;
        border = BorderSide(
          color: isSelected ? AppColors.primary : AppColors.border,
          width: 1,
        );
        break;
      case SkillChipType.neutral:
        bg = AppColors.borderLight;
        text = AppColors.textSecondary;
        break;
    }

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(20),
            border: border != BorderSide.none ? Border.fromBorderSide(border) : null,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (type == SkillChipType.teach) ...[
                const Icon(Icons.school_outlined, size: 13, color: AppColors.teachBadgeText),
                const SizedBox(width: 4),
              ] else if (type == SkillChipType.learn) ...[
                const Icon(Icons.menu_book_outlined, size: 13, color: AppColors.learnBadgeText),
                const SizedBox(width: 4),
              ],
              Text(
                label,
                style: AppTypography.caption.copyWith(
                  color: text,
                  fontWeight: FontWeight.w600,
                ),
              ),
              if (onDeleted != null) ...[
                const SizedBox(width: 4),
                GestureDetector(
                  onTap: onDeleted,
                  child: Icon(Icons.close, size: 14, color: text),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
