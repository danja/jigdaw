import math, cairosvg
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

INK="#10183A"; COBALT="#2A44D0"; SIGNAL="#FFC93C"; PAPER="#EEF1F8"; DEEP="#1A2A8C"

def d(u, A):
    a,b=0.26,0.74
    if u<=a or u>=b: return 0.0
    return A*math.sin(2*math.pi*(u-a)/(b-a))

def piece(x,y,s,A=0.17,top=True,right=True,bottom=False,left=False,N=80):
    A=A*s; P=[]
    for i in range(N+1):
        u=i/N; P.append((x+u*s, y-(d(u,A) if top else 0)))
    for i in range(1,N+1):
        u=i/N; P.append((x+s+(d(u,A) if right else 0), y+u*s))
    for i in range(1,N+1):
        u=1-i/N; P.append((x+u*s, y+s-(d(u,A) if bottom else 0)))
    for i in range(1,N):
        u=1-i/N; P.append((x+(d(u,A) if left else 0), y+u*s))
    return "M"+" L".join(f"{px:.2f},{py:.2f}" for px,py in P)+"Z"

# font
vf=TTFont("bric.ttf")
f=instancer.instantiateVariableFont(vf,{"wght":760,"wdth":88,"opsz":96})
gs=f.getGlyphSet(); cmap=f.getBestCmap(); upm=f["head"].unitsPerEm; hmtx=f["hmtx"]
def text_path(txt,x,y,size,track=0):
    sc=size/upm; out=[]; cx=x
    for ch in txt:
        g=cmap[ord(ch)]; pen=SVGPathPen(gs)
        gs[g].draw(TransformPen(pen,(sc,0,0,-sc,cx,y)))
        out.append(pen.getCommands()); cx+=hmtx[g][0]*sc+track*size
    return " ".join(out), cx-x
def svgdoc(w,h,body): return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{body}</svg>'

# --- mark (square) ---
mark_body=f'<path d="{piece(22,40,132)}" fill="{COBALT}"/>'
mark=svgdoc(200,200,mark_body)
open("jigdaw-mark.svg","w").write(mark)

# --- favicon: heavier amplitude, filled square bg for tiny sizes ---
fav=svgdoc(64,64,f'<rect width="64" height="64" rx="14" fill="{INK}"/><path d="{piece(10,18,38,A=0.2)}" fill="{SIGNAL}"/>')
open("favicon.svg","w").write(fav)

# --- horizontal logo ---
wp,ww=text_path("JigDAW",0,0,120,-0.01)
W=int(200+ww+40)
logo=svgdoc(W,200,mark_body+f'<path transform="translate(200,146)" d="{wp}" fill="{INK}"/>')
open("jigdaw-logo.svg","w").write(logo)
logo_rev=svgdoc(W,200,f'<path d="{piece(22,40,132)}" fill="{SIGNAL}"/><path transform="translate(200,146)" d="{wp}" fill="{PAPER}"/>')
open("jigdaw-logo-dark.svg","w").write(logo_rev)

# --- social card 1200x630 ---
s=120; row_y=440; parts=[]
for i in range(-1,11):
    x=i*s+20
    for j in range(2):
        yy=row_y+j*s
        lifted = (i==6 and j==0)
        if lifted:
            continue
        fill = COBALT if (i+j)%2==0 else DEEP
        parts.append(f'<path d="{piece(x,yy,s,A=0.13,top=True,right=True,bottom=True,left=True)}" fill="{fill}"/>')
# the lifted yellow piece
lx=6*s+20
parts.append(f'<path d="{piece(lx,row_y,s,A=0.13,top=True,right=True,bottom=True,left=True)}" fill="{INK}" opacity="0.55" transform="translate(0,0)"/>')
parts.append(f'<g transform="translate(22,-96) rotate(-7 {lx+s/2} {row_y+s/2})"><path d="{piece(lx,row_y,s,A=0.13,top=True,right=True,bottom=True,left=True)}" fill="{SIGNAL}"/></g>')
tp,tw=text_path("JigDAW",0,0,168,-0.015)
sp,sw=text_path("A plugin is a URL.",0,0,54,0)
up,uw=text_path("danja.github.io/jigdaw",0,0,26,0.01)
card=svgdoc(1200,630,f'<rect width="1200" height="630" fill="{INK}"/>'+"".join(parts)+
  f'<path transform="translate(80,215)" d="{tp}" fill="{PAPER}"/>'
  f'<path transform="translate(84,300)" d="{sp}" fill="{SIGNAL}"/>'
  f'<path transform="translate(86,74)" d="{up}" fill="{PAPER}" opacity="0.6"/>')
open("jigdaw-social-card.svg","w").write(card)

# renders
cairosvg.svg2png(url="jigdaw-social-card.svg",write_to="jigdaw-social-card.png",output_width=1200,output_height=630)
cairosvg.svg2png(url="jigdaw-logo.svg",write_to="jigdaw-logo.png",output_width=W*3,output_height=600)
cairosvg.svg2png(url="jigdaw-logo-dark.svg",write_to="jigdaw-logo-dark.png",output_width=W*3,output_height=600)
cairosvg.svg2png(url="jigdaw-mark.svg",write_to="jigdaw-mark-512.png",output_width=512,output_height=512)
for n in (16,32,48,180,192,512):
    cairosvg.svg2png(url="favicon.svg",write_to=f"fav-{n}.png",output_width=n,output_height=n)
print(W)
