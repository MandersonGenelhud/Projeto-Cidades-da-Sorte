import sys
from PIL import Image, ImageDraw, ImageFont
# Uso: python3 tools/arte-oferta.py ARTE_ORIGINAL.png NUMERO_DE_PESSOAS ARTE_FINAL.png
# ATENÇÃO: a oferta passou a valer para TODOS que pagarem a entrada até 12/11; as caixas "20 VAGAS" e "À VISTA" da arte antiga ficam desatualizadas (o título faz parte da imagem). Use uma arte nova (ver docs/oferta-relampago-arte.md).
# Troca o texto das caixas "20 VAGAS" e "À VISTA" da arte da oferta relâmpago: "mais de X pessoas" (X arredondado para baixo na centena) e "à vista ou até 3x no cartão".
SRC=sys.argv[1]; n=int(sys.argv[2]); out=sys.argv[3]
r=(n//100)*100
label=f"{r:,}".replace(',','.')
im=Image.open(SRC).convert('RGB'); W,H=im.size
d=ImageDraw.Draw(im)
def font(sz,bold=False):
    for f in ['/usr/share/fonts/opentype/inter/Inter-Medium.otf','/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        try: return ImageFont.truetype(f,sz)
        except: pass
    return ImageFont.load_default()
def bold(sz):
    for f in ['/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf','/usr/share/fonts/opentype/inter/Inter-Bold.otf','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']:
        try: return ImageFont.truetype(f,sz)
        except Exception: pass
    return ImageFont.load_default()
def wipe(x0,y0,x1,y1,sample_x):
    for y in range(y0,y1):
        c=im.getpixel((sample_x,y))
        d.line([(x0,y),(x1,y)],fill=c)
def center_lines(lines,cx,y,f,fill,gap):
    for ln in lines:
        w=d.textlength(ln,font=f); d.text((cx-w/2,y),ln,font=f,fill=fill); y+=gap
# caixa 1: texto abaixo do título
wipe(52,1000,372,1080,48)
center_lines(['Para todos que fecharem e',f'derem a entrada até 12/11.','Somos mais de '+label+' nos grupos.'],212,1006,font(19),(236,240,232),26)
# caixa 2: À VISTA (texto abaixo do título)
wipe(410,1000,705,1080,408)
center_lines(['À vista, cartão em até 3x','ou entrada com etapas.','Brinde de 12 meses.'],558,1006,font(19),(236,240,232),26)
im.save(out)
print('ok',label)
